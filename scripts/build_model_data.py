#!/usr/bin/env python3
"""Build model_data.json/js from SCB raw CSV extracts.

V1.3 intentionally creates a fully runnable demographic baseline from observed
SCB data before future national assumption tables are wired in. It calibrates
age/sex mortality, age-specific fertility and age/sex net migration for the
6-, 10- and 19-year windows ending 2024. The 2025 CKM observations are kept as
diagnostics/control data rather than mixed into the pre-CKM calibration.
"""
from __future__ import annotations

import csv
import json
import math
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT_JSON = ROOT / "data" / "model_data.json"
OUT_JS = ROOT / "data" / "model_data.js"

MUNICIPALITIES = {
    "2580": "Luleå kommun",
    "2582": "Bodens kommun",
    "2581": "Piteå kommun",
    "2560": "Älvsbyns kommun",
    "2514": "Kalix kommun",
}
FA_CODE = "FA_LULEA"
WINDOWS = (6, 10, 19)
CALIBRATION_END = 2024
SEX_MAP = {"1": "M", "2": "K", "M": "M", "K": "K"}

# Same concepts in the pre-CKM and 2025 CKM tables.
NET_MIG_CODES = {"BE0101AZ", "00000868"}

def sniff(path: Path):
    text = path.read_text(encoding="utf-8")
    try:
        return csv.Sniffer().sniff(text[:10000], delimiters=";,\t,")
    except csv.Error:
        return csv.excel

def rows(path: Path):
    dialect = sniff(path)
    with path.open("r", encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f, dialect=dialect)

def num(value) -> float:
    if value is None:
        return 0.0
    s = str(value).strip().replace(" ", "").replace(",", ".")
    if s in ("", "..", "-", "—"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0

def age_value(code: str) -> int | None:
    c = str(code).strip()
    if c in {"100+", "100+1"}:
        return 100
    if c.isdigit():
        n = int(c)
        return n if 0 <= n <= 100 else None
    if c == "49+":
        return 49
    return None

def value_columns(fieldnames, content_codes=None):
    out = []
    for h in fieldnames or []:
        m = re.search(r"(19|20)\d{2}$", h or "")
        if not m:
            continue
        year = int(m.group(0))
        code = (h.rsplit(" ", 1)[0] if " " in h else "")
        if content_codes and code not in content_codes:
            continue
        out.append((h, code, year))
    return out

def load_population_2025():
    path = RAW / "population_2025.csv"
    data = defaultdict(float)
    for r in rows(path):
        if "Civilstand" in r and r["Civilstand"] != "SC":
            continue
        age = age_value(r.get("Alder", ""))
        sex = SEX_MAP.get(r.get("Kon", ""))
        geo = r.get("Region")
        if age is None or not sex or geo not in MUNICIPALITIES:
            continue
        for col, _, year in value_columns(r.keys()):
            if year == 2025:
                data[(geo, sex, age)] += num(r[col])
    return data

def load_wide_age_sex(filename: str, allowed_codes=None):
    path = RAW / filename
    out = defaultdict(float)
    for r in rows(path):
        age = age_value(r.get("Alder", ""))
        sex = SEX_MAP.get(r.get("Kon", ""))
        geo = r.get("Region")
        if age is None or not sex or geo not in MUNICIPALITIES:
            continue
        for col, code, year in value_columns(r.keys(), allowed_codes):
            out[(geo, year, sex, age)] += num(r[col])
    return out

def load_births(filename: str):
    path = RAW / filename
    out = defaultdict(float)
    for r in rows(path):
        age = age_value(r.get("AlderModer", ""))
        geo = r.get("Region")
        if age is None or geo not in MUNICIPALITIES or not (15 <= age <= 49):
            continue
        # Sum boys + girls to births by mother's age.
        for col, _, year in value_columns(r.keys()):
            out[(geo, year, age)] += num(r[col])
    return out

def load_births_by_child_sex(filename: str):
    """Births by municipality, year and child's sex, without double-counting ages."""
    path = RAW / filename
    out = defaultdict(float)
    for r in rows(path):
        age = age_value(r.get("AlderModer", ""))
        geo = r.get("Region")
        sex = SEX_MAP.get(r.get("Kon", ""))
        if age is None or geo not in MUNICIPALITIES or not sex or not (15 <= age <= 49):
            continue
        for col, _, year in value_columns(r.keys()):
            out[(geo, year, sex)] += num(r[col])
    return out

def observed_male_birth_share(births_by_sex, years=range(2015, 2025)):
    male = female = 0.0
    for geo in MUNICIPALITIES:
        for year in years:
            male += births_by_sex.get((geo, year, "M"), 0)
            female += births_by_sex.get((geo, year, "K"), 0)
    total = male + female
    return 0.5 if total <= 0 else male / total

def aggregate_fa_age_sex(source):
    out = defaultdict(float)
    for (geo, year, sex, age), value in source.items():
        out[(geo, year, sex, age)] += value
        out[(FA_CODE, year, sex, age)] += value
    return out

def aggregate_fa_births(source):
    out = defaultdict(float)
    for (geo, year, age), value in source.items():
        out[(geo, year, age)] += value
        out[(FA_CODE, year, age)] += value
    return out

def window_years(window):
    return range(CALIBRATION_END - window + 1, CALIBRATION_END + 1)

def mortality_profiles(deaths, exposure):
    result = []
    geos = list(MUNICIPALITIES) + [FA_CODE]
    for window in WINDOWS:
        yrs = set(window_years(window))
        for geo in geos:
            for sex in ("K", "M"):
                for age in range(101):
                    d = sum(deaths.get((geo, y, sex, age), 0) for y in yrs)
                    p = sum(exposure.get((geo, y, sex, age), 0) for y in yrs)
                    risk = 0 if p <= 0 else max(0.0, min(1.0, 1 - math.exp(-d / p)))
                    result.append({
                        "geo": geo, "window": window, "sex": sex,
                        "age": age, "value": risk,
                        "events": d, "exposure": p,
                    })
    return result

def fertility_profiles(births, exposure):
    result = []
    geos = list(MUNICIPALITIES) + [FA_CODE]
    for window in WINDOWS:
        yrs = set(window_years(window))
        for geo in geos:
            for age in range(15, 50):
                b = sum(births.get((geo, y, age), 0) for y in yrs)
                women = sum(exposure.get((geo, y, "K", age), 0) for y in yrs)
                rate = 0 if women <= 0 else b / women
                result.append({
                    "geo": geo, "window": window, "age": age,
                    "value": max(0.0, rate),
                    "births": b, "female_exposure": women,
                })
    return result

def migration_profiles(netmig):
    result = []
    geos = list(MUNICIPALITIES) + [FA_CODE]
    for window in WINDOWS:
        yrs = set(window_years(window))
        denom = float(window)
        for geo in geos:
            for sex in ("K", "M"):
                for age in range(101):
                    total = sum(netmig.get((geo, y, sex, age), 0) for y in yrs)
                    result.append({
                        "geo": geo, "window": window, "year": "BASE",
                        "sex": sex, "age": age, "value": total / denom,
                    })
    return result

def add_fa_population(base):
    out = dict(base)
    for sex in ("K", "M"):
        for age in range(101):
            out[(FA_CODE, sex, age)] = sum(
                base.get((geo, sex, age), 0) for geo in MUNICIPALITIES
            )
    return out

def ckm_diagnostics(base, deaths_2025, netmig_2025):
    diagnostics = []
    for geo in list(MUNICIPALITIES) + [FA_CODE]:
        pop_total = sum(v for (g, _, _), v in base.items() if g == geo)
        if pop_total:
            diagnostics.append({
                "geo": geo, "year": 2025, "metric": "population_total",
                "value": pop_total,
                "maxRelativePctSingleCell": 100 * 3 / pop_total,
                "note": "Indicative only; aggregate CKM uncertainty is not bounded by ±3."
            })
    return diagnostics

def main():
    required = [
        "population_2025.csv", "mean_population_pre2025.csv",
        "migration_pre2025.csv", "births_pre2025.csv",
        "deaths_pre2025.csv"
    ]
    missing = [p for p in required if not (RAW / p).exists()]
    if missing:
        raise SystemExit("Missing raw SCB files: " + ", ".join(missing))

    base = add_fa_population(load_population_2025())
    exposure = aggregate_fa_age_sex(load_wide_age_sex("mean_population_pre2025.csv"))
    deaths = aggregate_fa_age_sex(load_wide_age_sex("deaths_pre2025.csv"))
    births = aggregate_fa_births(load_births("births_pre2025.csv"))
    births_by_sex = load_births_by_child_sex("births_pre2025.csv")
    male_birth_share = observed_male_birth_share(births_by_sex)
    netmig = aggregate_fa_age_sex(
        load_wide_age_sex("migration_pre2025.csv", NET_MIG_CODES)
    )

    deaths_2025 = {}
    netmig_2025 = {}
    if (RAW / "deaths_2025.csv").exists():
        deaths_2025 = aggregate_fa_age_sex(load_wide_age_sex("deaths_2025.csv"))
    if (RAW / "migration_2025.csv").exists():
        netmig_2025 = aggregate_fa_age_sex(
            load_wide_age_sex("migration_2025.csv", NET_MIG_CODES)
        )

    model = {
        "meta": {
            "schemaVersion": "0.3.0",
            "generatedBy": "scripts/build_model_data.py",
            "dataReady": True,
            "baseYear": 2025,
            "projectionAssumptionVersion": "observed-local-constant-v1",
            "methodBreakYear": 2025,
            "methodBreak": "SCB Cell Key Method (CKM)",
            "calibrationEndYear": CALIBRATION_END,
            "note": (
                "First operational baseline. Fertility, mortality and net migration "
                "are held at locally calibrated age/sex profiles from 6/10/19-year "
                "pre-CKM windows ending 2024. National future SCB assumptions will "
                "replace the constant profiles in the next model stage."
            ),
        },
        "geographies": [
            {"code": FA_CODE, "name": "Luleå FA",
             "members": list(MUNICIPALITIES)},
            *[{"code": c, "name": n} for c, n in MUNICIPALITIES.items()],
        ],
        "calibration": {
            "defaultYears": 10,
            "options": list(WINDOWS),
            "preCkmEnd": 2024,
            "ckmStart": 2025,
            "ckmCellDelta": 3,
        },
        "parameters": {
            "qutbMode": "identity",
            "endogenousInMigration": False,
            "endogenousOutMigration": False,
            "iflMode": "deferred",
            "sexRatioMaleAtBirth": male_birth_share,
            "sexRatioMaleAtBirthSource": "Observed births in the five FA municipalities, 2015-2024",
        },
        "populationBase": [
            {"geo": geo, "year": 2025, "sex": sex, "age": age, "value": value}
            for (geo, sex, age), value in sorted(base.items())
        ],
        "fertilityRates": fertility_profiles(births, exposure),
        "mortalityRisks": mortality_profiles(deaths, exposure),
        "netMigration": migration_profiles(netmig),
        "diagnostics": {
            "ckm": ckm_diagnostics(base, deaths_2025, netmig_2025),
            "calibrationWindows": list(WINDOWS),
            "faNetMigrationPrinciple": (
                "Municipal net migration is summed to FA because internal "
                "municipal moves cancel in the net."
            ),
        },
    }

    OUT_JSON.write_text(
        json.dumps(model, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    OUT_JS.write_text(
        "window.MODEL_DATA = " +
        json.dumps(model, ensure_ascii=False, separators=(",", ":")) +
        ";\n",
        encoding="utf-8",
    )

    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")
    print(f"Wrote {OUT_JS.relative_to(ROOT)}")
    print(f"Observed male birth share 2015-2024: {male_birth_share:.6f}")
    for window in WINDOWS:
        print(
            f"window={window}: fertility={sum(1 for r in model['fertilityRates'] if r['window']==window)}, "
            f"mortality={sum(1 for r in model['mortalityRisks'] if r['window']==window)}, "
            f"migration={sum(1 for r in model['netMigration'] if r['window']==window)}"
        )

if __name__ == "__main__":
    main()
