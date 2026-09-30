#!/usr/bin/env python3
"""Normalize SCB TAB6008 regional population projection for model comparison."""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "regional_forecast_benchmark.csv"
OUTDIR = ROOT / "data" / "benchmarks"
OUTDIR.mkdir(parents=True, exist_ok=True)
OUT = OUTDIR / "scb_regional_projection_normalized.json"

MUNICIPALITIES = ["2580", "2582", "2581", "2560", "2514"]
FA = "FA_LULEA"

def sniff(text: str):
    try:
        return csv.Sniffer().sniff(text[:10000], delimiters=";,\t,")
    except csv.Error:
        return csv.excel

def num(x):
    s = str(x or "").strip().replace(" ", "").replace(",", ".")
    if s in ("", "..", "-", "—"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0

def main():
    if not RAW.exists():
        raise SystemExit(f"Missing {RAW.relative_to(ROOT)}")

    text = RAW.read_text(encoding="utf-8")
    dialect = sniff(text)
    reader = csv.DictReader(text.splitlines(), dialect=dialect)
    fields = reader.fieldnames or []
    value_cols = []
    for h in fields:
        m = re.search(r"(20\d{2})$", h or "")
        if m:
            value_cols.append((h, int(m.group(1))))
    if not value_cols:
        raise SystemExit(f"No year value columns found in header: {fields!r}")

    totals = defaultdict(float)
    for r in reader:
        geo = r.get("Region")
        if geo not in MUNICIPALITIES:
            continue
        # Extraction already selects the total birth-region category where it exists.
        for col, year in value_cols:
            totals[(geo, year)] += num(r.get(col))

    rows = []
    years = sorted({y for _, y in totals})
    for geo in MUNICIPALITIES:
        for year in years:
            rows.append({"geo": geo, "year": year, "population": totals[(geo, year)]})
    for year in years:
        rows.append({
            "geo": FA,
            "year": year,
            "population": sum(totals[(g, year)] for g in MUNICIPALITIES)
        })

    out = {
        "schemaVersion": "0.1.0",
        "sourceTable": "TAB6008",
        "sourceDescription": "SCB regional population projection 2024-2070",
        "note": "Alternative benchmark. SCB assumes observed recent demographic patterns continue and does not include local housing or establishment plans.",
        "rows": rows,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")

if __name__ == "__main__":
    main()
