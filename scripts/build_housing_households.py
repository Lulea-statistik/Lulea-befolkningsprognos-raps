#!/usr/bin/env python3
"""Build household/housing analysis data for the dashboard.

Sources:
- HushallT29 / TAB4538: persons per household by housing form, including small houses.
- HushallT30 / TAB4937: households and persons/household by housing form and apartment type.
- HushallT05 / TAB1533: households/persons by household type and number of children.
- HushallT09 / TAB4374: household totals and average household size.
- BO0104T04 / TAB824: dwelling stock by building type and tenure.

The resulting occupancy defaults are descriptive SCB observations. They are
scenario defaults, not physical capacity limits for a dwelling.
"""
from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT_JSON = ROOT / "data" / "housing_households.json"
OUT_JS = ROOT / "data" / "housing_households.js"
MANIFEST = RAW / "manifest.json"

MUNICIPALITIES = {
    "2580": "Luleå kommun",
    "2582": "Bodens kommun",
    "2581": "Piteå kommun",
    "2560": "Älvsbyns kommun",
    "2514": "Kalix kommun",
}
RIKET = "00"

def norm(value: str) -> str:
    s = unicodedata.normalize("NFKD", str(value or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", s.strip().lower())

def number(value):
    s = str(value or "").strip().replace(" ", "").replace(",", ".")
    if s in {"", "..", "-", "—"}:
        return None
    try:
        return float(s)
    except ValueError:
        return None

def load_manifest():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))

def read_rows(file_key):
    path = RAW / f"{file_key}.csv"
    with path.open("r", encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f)

def entry(manifest, file_key):
    return (manifest.get("files") or {}).get(file_key) or {}

def value_label(manifest, file_key, dim_id, code):
    labels = (entry(manifest, file_key).get("dimension_value_labels") or {}).get(dim_id) or {}
    return labels.get(str(code), str(code))

def dimension_id(manifest, file_key, terms):
    labels = entry(manifest, file_key).get("dimension_labels") or {}
    terms = [norm(t) for t in terms]
    for dim_id, label in labels.items():
        hay = norm(label) + " " + norm(dim_id)
        if any(t in hay for t in terms):
            return dim_id
    return None

def content_columns(manifest, file_key, fieldnames):
    labels = entry(manifest, file_key).get("content_labels") or {}
    out = []
    for h in fieldnames or []:
        m = re.search(r"(19|20)\d{2}$", h or "")
        if not m:
            continue
        year = int(m.group(0))
        code = h.rsplit(" ", 1)[0] if " " in h else ""
        out.append((h, code, year, labels.get(code, code)))
    return out

def housing_form(label):
    s = norm(label)
    if "smahus" in s:
        dwelling = "småhus"
    elif "flerbostadshus" in s:
        dwelling = "flerbostadshus"
    else:
        return None
    tenure = None
    if "aganderatt" in s:
        tenure = "äganderätt"
    elif "bostadsratt" in s:
        tenure = "bostadsrätt"
    elif "hyresratt" in s:
        tenure = "hyresrätt"
    if not tenure:
        return None
    return dwelling, tenure

def apartment_size(label):
    s = norm(label)
    if any(x in s for x in ("samtliga", "totalt", "alla lagenhet")):
        return "alla"
    m = re.search(r"(^|\D)(\d+)\s*rum", s)
    if not m:
        return None
    rooms = int(m.group(2))
    if rooms >= 5:
        return "5+"
    return f"{rooms} rum"

def stock_building_type(label):
    s = norm(label)
    if "smahus" in s:
        return "småhus"
    if "flerbostadshus" in s:
        return "flerbostadshus"
    if "ovriga hus" in s:
        return "övriga hus"
    if "specialbost" in s:
        return "specialbostäder"
    return None

def stock_tenure(label):
    s = norm(label)
    if "hyresratt" in s:
        return "hyresrätt"
    if "bostadsratt" in s:
        return "bostadsrätt"
    if "aganderatt" in s:
        return "äganderätt"
    if "uppgift saknas" in s or "okand" in s:
        return "uppgift saknas"
    return None

def occupancy_defaults(manifest):
    result = []

    # Small houses: HushallT29 provides housing-form averages.
    key = "household_size_by_tenure"
    rows = list(read_rows(key))
    if rows:
        region_dim = dimension_id(manifest, key, ["region"]) or "Region"
        form_dim = dimension_id(manifest, key, ["boendeform"]) or "Boendeform"
        cols = content_columns(manifest, key, rows[0].keys())
        pph_cols = [x for x in cols if "personer per hushall" in norm(x[3])]
        for r in rows:
            geo = r.get(region_dim)
            if geo not in set(MUNICIPALITIES) | {RIKET}:
                continue
            form = housing_form(value_label(manifest, key, form_dim, r.get(form_dim)))
            if not form or form[0] != "småhus":
                continue
            for col, _, year, _ in pph_cols:
                val = number(r.get(col))
                if val is None:
                    continue
                result.append({
                    "geo": geo, "year": year,
                    "dwellingType": form[0], "tenure": form[1],
                    "size": "alla", "personsPerDwelling": val,
                    "source": "SCB HushallT29 / TAB4538",
                })

    # Multifamily dwellings: weight detailed apartment labels by household count.
    key = "household_size_by_apartment"
    rows = list(read_rows(key))
    grouped = defaultdict(lambda: {"households": 0.0, "persons": 0.0, "unweighted": []})
    if rows:
        region_dim = dimension_id(manifest, key, ["region"]) or "Region"
        form_dim = dimension_id(manifest, key, ["boendeform"]) or "Boendeform"
        apt_dim = dimension_id(manifest, key, ["lagenhetstyp", "lägenhetstyp"]) or "Lagenhetstyp"
        cols = content_columns(manifest, key, rows[0].keys())
        hh_cols = {(year): col for col, _, year, label in cols if norm(label).startswith("antal hushall")}
        pph_cols = {(year): col for col, _, year, label in cols if "personer per hushall" in norm(label)}
        years = sorted(set(hh_cols) | set(pph_cols))
        for r in rows:
            geo = r.get(region_dim)
            if geo not in set(MUNICIPALITIES) | {RIKET}:
                continue
            form = housing_form(value_label(manifest, key, form_dim, r.get(form_dim)))
            if not form or form[0] != "flerbostadshus":
                continue
            size = apartment_size(value_label(manifest, key, apt_dim, r.get(apt_dim)))
            if not size:
                continue
            for year in years:
                pph = number(r.get(pph_cols.get(year, ""))) if year in pph_cols else None
                hh = number(r.get(hh_cols.get(year, ""))) if year in hh_cols else None
                if pph is None:
                    continue
                g = grouped[(geo, year, form[0], form[1], size)]
                g["unweighted"].append(pph)
                if hh is not None and hh > 0:
                    g["households"] += hh
                    g["persons"] += hh * pph

    for (geo, year, dwelling, tenure, size), g in grouped.items():
        if g["households"] > 0:
            pph = g["persons"] / g["households"]
        elif g["unweighted"]:
            pph = sum(g["unweighted"]) / len(g["unweighted"])
        else:
            continue
        result.append({
            "geo": geo, "year": year,
            "dwellingType": dwelling, "tenure": tenure,
            "size": size, "personsPerDwelling": pph,
            "source": "SCB HushallT30 / TAB4937",
        })

    return sorted(result, key=lambda r: (
        r["geo"], r["year"], r["dwellingType"], r["tenure"], r["size"]
    ))

def household_totals(manifest):
    key = "household_totals"
    rows = list(read_rows(key))
    if not rows:
        return []
    region_dim = dimension_id(manifest, key, ["region"]) or "Region"
    cols = content_columns(manifest, key, rows[0].keys())
    out = []
    for r in rows:
        geo = r.get(region_dim)
        if geo not in set(MUNICIPALITIES) | {RIKET}:
            continue
        by_year = defaultdict(dict)
        for col, _, year, label in cols:
            nlabel = norm(label)
            val = number(r.get(col))
            if val is None:
                continue
            if nlabel.startswith("antal hushall"):
                by_year[year]["households"] = val
            elif "personer per hushall" in nlabel:
                by_year[year]["personsPerHousehold"] = val
        for year, vals in by_year.items():
            if vals:
                out.append({"geo": geo, "year": year, **vals})
    return sorted(out, key=lambda r: (r["geo"], r["year"]))

def household_composition(manifest):
    key = "households_by_type"
    rows = list(read_rows(key))
    if not rows:
        return []
    region_dim = dimension_id(manifest, key, ["region"]) or "Region"
    type_dim = dimension_id(manifest, key, ["hushallstyp", "hushållstyp"]) or "Hushallstyp"
    child_dim = dimension_id(manifest, key, ["antal barn"]) or "AntalBarn"
    cols = content_columns(manifest, key, rows[0].keys())
    out = []
    for r in rows:
        geo = r.get(region_dim)
        if geo not in MUNICIPALITIES:
            continue
        child_label = norm(value_label(manifest, key, child_dim, r.get(child_dim)))
        if not any(x in child_label for x in ("totalt", "samtliga")):
            continue
        type_label = value_label(manifest, key, type_dim, r.get(type_dim))
        if any(x in norm(type_label) for x in ("samtliga hushall", "totalt")):
            continue
        vals = defaultdict(dict)
        for col, _, year, label in cols:
            if year != 2024:
                continue
            val = number(r.get(col))
            if val is None:
                continue
            nlabel = norm(label)
            if nlabel.startswith("antal hushall"):
                vals[year]["households"] = val
            elif nlabel.startswith("antal personer"):
                vals[year]["persons"] = val
        if 2024 in vals and vals[2024].get("households", 0) > 0:
            hh = vals[2024]["households"]
            persons = vals[2024].get("persons")
            out.append({
                "geo": geo,
                "year": 2024,
                "householdType": type_label,
                "households": hh,
                "persons": persons,
                "personsPerHousehold": None if persons is None else persons / hh,
            })
    return sorted(out, key=lambda r: (r["geo"], r["householdType"]))

def housing_stock(manifest):
    key = "housing_stock"
    rows = list(read_rows(key))
    if not rows:
        return []
    region_dim = dimension_id(manifest, key, ["region"]) or "Region"
    type_dim = dimension_id(manifest, key, ["hustyp"]) or "Hustyp"
    tenure_dim = dimension_id(manifest, key, ["upplatelseform", "upplåtelseform"]) or "Upplatelseform"
    cols = content_columns(manifest, key, rows[0].keys())
    out = []
    for r in rows:
        geo = r.get(region_dim)
        if geo not in MUNICIPALITIES:
            continue
        dwelling = stock_building_type(value_label(manifest, key, type_dim, r.get(type_dim)))
        tenure = stock_tenure(value_label(manifest, key, tenure_dim, r.get(tenure_dim)))
        if not dwelling or not tenure:
            continue
        for col, _, year, _ in cols:
            val = number(r.get(col))
            if val is None:
                continue
            out.append({
                "geo": geo, "year": year,
                "dwellingType": dwelling, "tenure": tenure,
                "dwellings": val,
            })
    return sorted(out, key=lambda r: (r["geo"], r["year"], r["dwellingType"], r["tenure"]))

def main():
    manifest = load_manifest()
    defaults = occupancy_defaults(manifest)
    totals = household_totals(manifest)
    composition = household_composition(manifest)
    stock = housing_stock(manifest)

    if not defaults:
        raise RuntimeError("No SCB occupancy defaults were built.")
    if not totals:
        raise RuntimeError("No household totals were built.")
    if not stock:
        raise RuntimeError("No housing stock rows were built.")

    data = {
        "meta": {
            "schemaVersion": "0.1.0",
            "occupancyDefaultYear": 2024,
            "latestHouseholdYear": max(r["year"] for r in totals),
            "latestHousingStockYear": max(r["year"] for r in stock),
            "occupancyNote": (
                "Persons per dwelling is derived from observed persons per household. "
                "It is a scenario default, not a maximum dwelling capacity."
            ),
            "demandNote": (
                "Projected household demand is an indicative household-formation proxy, "
                "not a market-price or vacancy forecast."
            ),
        },
        "geographies": [
            {"code": code, "name": name} for code, name in MUNICIPALITIES.items()
        ],
        "occupancyDefaults": defaults,
        "householdTotals": totals,
        "householdComposition": composition,
        "housingStock": stock,
    }
    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUT_JS.write_text(
        "window.HOUSING_HOUSEHOLD_DATA = " +
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) +
        ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT_JSON.relative_to(ROOT)} / {OUT_JS.relative_to(ROOT)}")
    print(f"occupancy defaults={len(defaults)}, household totals={len(totals)}, stock rows={len(stock)}")

if __name__ == "__main__":
    main()
