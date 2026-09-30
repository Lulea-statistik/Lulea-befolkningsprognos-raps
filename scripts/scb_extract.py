#!/usr/bin/env python3
"""Download selected SCB PxWebApi v2 tables for the Luleå rAps-like model.

The script reads data/scb_sources.json, inspects table metadata, and downloads
CSV extracts for the five municipalities. It deliberately stores raw extracts
before model transformation so source data and modelling assumptions remain
separate and auditable.
"""
from __future__ import annotations

import csv
import io
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = "https://statistikdatabasen.scb.se/api/v2"
ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "data" / "scb_sources.json"
OUT = ROOT / "data" / "raw"

MUNICIPALITIES = ["2580", "2582", "2581", "2560", "2514"]
MODEL_AGES = [str(i) for i in range(100)] + ["100+"]
SEXES = ["1", "2"]

def request_text(url: str) -> str:
    req = Request(url, headers={"User-Agent": "lulea-raps-model/0.3"})
    with urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8-sig")

def request_json(url: str):
    return json.loads(request_text(url))

def metadata(table_id: str):
    return request_json(f"{BASE}/tables/{table_id}/metadata?lang=sv&defaultSelection=false")

def labels(dim: dict) -> dict[str, str]:
    return (dim.get("category") or {}).get("label") or {}

def values(dim: dict) -> list[str]:
    idx = (dim.get("category") or {}).get("index") or {}
    if isinstance(idx, dict):
        return list(idx.keys())
    return []

def choose_content_codes(md: dict, wanted_terms: list[str] | None = None) -> list[str]:
    dim = (md.get("dimension") or {}).get("ContentsCode")
    if not dim:
        return []
    labs = labels(dim)
    if not wanted_terms:
        return list(labs.keys())
    selected = []
    for code, label in labs.items():
        ll = label.lower()
        if any(term.lower() in ll for term in wanted_terms):
            selected.append(code)
    return selected or list(labs.keys())

def choose_years(md: dict, start: int | None, end: int | None) -> list[str]:
    dim = (md.get("dimension") or {}).get("Tid")
    years = values(dim or {})
    out = []
    for y in years:
        try:
            iy = int(y)
        except ValueError:
            continue
        if start is not None and iy < start:
            continue
        if end is not None and iy > end:
            continue
        out.append(y)
    return out

def build_selection(md: dict, spec: dict) -> dict[str, list[str]]:
    dims = md.get("dimension") or {}
    sel: dict[str, list[str]] = {}
    for dim_id, dim in dims.items():
        vals = values(dim)
        if dim_id == "Region":
            sel[dim_id] = [x for x in MUNICIPALITIES if x in vals]
        elif dim_id in ("Alder", "AlderModer"):
            if dim_id == "AlderModer":
                sel[dim_id] = [x for x in vals if x not in ("tot", "Total", "TOTAL")]
            else:
                sel[dim_id] = [x for x in MODEL_AGES if x in vals]
        elif dim_id == "Kon":
            sel[dim_id] = [x for x in SEXES if x in vals]
        elif dim_id == "Civilstand":
            sel[dim_id] = vals
        elif dim_id == "Fodelseregion":
            sel[dim_id] = vals
        elif dim_id == "ContentsCode":
            sel[dim_id] = choose_content_codes(md, spec.get("content_terms"))
        elif dim_id == "Tid":
            sel[dim_id] = choose_years(md, spec.get("start"), spec.get("end"))
        else:
            sel[dim_id] = vals
    return {k:v for k,v in sel.items() if v}

def encode_params(selection: dict[str, list[str]]) -> str:
    pairs: list[tuple[str,str]] = [("lang","sv"), ("outputFormat","csv")]
    for dim, vals in selection.items():
        for val in vals:
            pairs.append((f"valuecodes[{dim}]", val))
    return urlencode(pairs)

def download_csv(table_id: str, selection: dict[str, list[str]]) -> str:
    url = f"{BASE}/tables/{table_id}/data?" + encode_params(selection)
    return request_text(url)

SPECS = {
    "population_2025": {"start":2025,"end":2025,"content_terms":["Folkmängd"]},
    "mean_population_pre2025": {"start":2006,"end":2024},
    "mean_population_2025": {"start":2025,"end":2025},
    "migration_pre2025": {"start":2006,"end":2024},
    "migration_2025": {"start":2025,"end":2025},
    "births_pre2025": {"start":2006,"end":2024},
    "births_2025": {"start":2025,"end":2025},
    "deaths_pre2025": {"start":2006,"end":2024},
    "deaths_2025": {"start":2025,"end":2025},
    "migration_birth_region_pre2025": {"start":2006,"end":2024},
    "migration_birth_region_2025": {"start":2025,"end":2025},
}

def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"schema_version":"0.1.0","files":{}}

    for key, spec in SPECS.items():
        table = cfg["tables"][key]
        table_id = table["id"]
        print(f"Downloading {key} from {table_id}", file=sys.stderr)
        md = metadata(table_id)
        selection = build_selection(md, spec)
        if not selection:
            raise RuntimeError(f"No selection built for {key} / {table_id}")
        csv_text = download_csv(table_id, selection)
        if not csv_text.strip():
            raise RuntimeError(f"Empty response for {key} / {table_id}")
        path = OUT / f"{key}.csv"
        path.write_text(csv_text, encoding="utf-8")
        # Basic validation: at least header + one data row.
        rows = list(csv.reader(io.StringIO(csv_text)))
        if len(rows) < 2:
            raise RuntimeError(f"No data rows for {key} / {table_id}")
        manifest["files"][key] = {
            "table_id": table_id,
            "path": str(path.relative_to(ROOT)),
            "rows_including_header": len(rows),
            "selection": selection,
        }
        print(f"  {len(rows)-1} rows -> {path.relative_to(ROOT)}", file=sys.stderr)
        time.sleep(0.4)

    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(OUT / "manifest.json")

if __name__ == "__main__":
    main()
