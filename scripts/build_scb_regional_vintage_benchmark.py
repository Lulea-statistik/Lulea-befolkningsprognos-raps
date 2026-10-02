#!/usr/bin/env python3
"""Benchmark frozen SCB regional forecast vintages against realized population.

The official SCB regional projections are external benchmarks only. They are
never used to fit or drive the local model.
"""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path

import build_model_data as b

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "benchmarks" / "scb_regional_vintage_backtest.json"
MANIFEST = RAW / "manifest.json"
GEOS = ["2580", "2582", "2581", "2560", "2514"]
FA = "FA_LULEA"
VINTAGES = {
    2020: ("regional_flows_benchmark_2020", "TAB693"),
    2021: ("regional_flows_benchmark_2021", "TAB5996"),
    2022: ("regional_flows_benchmark_2022", "TAB6299"),
}

def num(x):
    s = str(x or "").strip().replace(" ", "").replace(",", ".")
    if s in ("", "..", "-", "—"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0

def sniff(path):
    text = path.read_text(encoding="utf-8")
    try:
        return csv.Sniffer().sniff(text[:10000], delimiters=";,\t,")
    except csv.Error:
        return csv.excel

def population_code(manifest, key):
    info = (manifest.get("files") or {}).get(key) or {}
    labels = info.get("content_labels") or {}
    for code, label in labels.items():
        if "folkmängd" in str(label).lower():
            return code
    return None

def forecast_population(path, code):
    totals = defaultdict(float)
    with path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, dialect=sniff(path))
        fields = reader.fieldnames or []
        year_cols = []
        for h in fields:
            m = re.search(r"(20\d{2})$", h or "")
            if not m:
                continue
            if code and not (h == m.group(1) or h.startswith(code + " ")):
                continue
            year_cols.append((h, int(m.group(1))))
        if not year_cols:
            raise RuntimeError(f"No population/year columns found in {path.name}")
        for r in reader:
            geo = r.get("Region")
            if geo not in GEOS:
                continue
            for col, year in year_cols:
                totals[(geo, year)] += num(r.get(col))
    return totals

def actual_population():
    raw = b.load_wide_age_sex("population_pre2025.csv", allowed_geos=set(GEOS))
    totals = defaultdict(float)
    for (geo, year, _sex, _age), value in raw.items():
        totals[(geo, year)] += value
    return totals

def summarize(rows):
    out = {}
    for geo in GEOS + [FA]:
        rr = [r for r in rows if r["geo"] == geo]
        if not rr:
            continue
        ae = [abs(r["error"]) for r in rr]
        ape = [r["absPctError"] for r in rr if r["absPctError"] is not None]
        by_h = {}
        for horizon in sorted({r["horizon"] for r in rr}):
            hh = [r for r in rr if r["horizon"] == horizon]
            by_h[str(horizon)] = {
                "observations": len(hh),
                "MAE": sum(abs(r["error"]) for r in hh) / len(hh),
                "MAPE": sum(r["absPctError"] for r in hh if r["absPctError"] is not None) / max(1, sum(r["absPctError"] is not None for r in hh)),
            }
        out[geo] = {
            "observations": len(rr),
            "MAE": sum(ae) / len(ae),
            "MAPE": sum(ape) / len(ape) if ape else None,
            "meanError": sum(r["error"] for r in rr) / len(rr),
            "byHorizon": by_h,
        }
    return out

def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {"files": {}}
    actual = actual_population()
    reports = {}
    missing = []

    for vintage, (key, table_id) in VINTAGES.items():
        path = RAW / f"{key}.csv"
        if not path.exists():
            missing.append(key)
            continue
        code = population_code(manifest, key)
        pred = forecast_population(path, code)
        rows = []
        years = sorted({year for geo, year in pred if year > vintage and year <= 2024})
        for year in years:
            for geo in GEOS:
                p = pred.get((geo, year), 0.0)
                a = actual.get((geo, year), 0.0)
                err = p - a
                rows.append({
                    "geo": geo, "year": year, "horizon": year - vintage,
                    "predictedPopulation": p, "actualPopulation": a,
                    "error": err,
                    "absPctError": None if a <= 0 else 100.0 * abs(err) / a,
                })
            pfa = sum(pred.get((g, year), 0.0) for g in GEOS)
            afa = sum(actual.get((g, year), 0.0) for g in GEOS)
            err = pfa - afa
            rows.append({
                "geo": FA, "year": year, "horizon": year - vintage,
                "predictedPopulation": pfa, "actualPopulation": afa,
                "error": err,
                "absPctError": None if afa <= 0 else 100.0 * abs(err) / afa,
            })
        reports[str(vintage)] = {
            "sourceTable": table_id,
            "sourceFile": str(path.relative_to(ROOT)),
            "rows": rows,
            "summary": summarize(rows),
        }

    if not reports:
        print("Historical SCB regional forecast vintages are not downloaded yet; benchmark skipped.")
        return

    result = {
        "schemaVersion": "0.1.0",
        "status": "external_historical_benchmark",
        "note": "Official SCB regional forecast vintages are compared with realized population only; they are not model inputs.",
        "availableVintages": sorted(int(v) for v in reports),
        "missingFrozenSources": missing,
        "vintages": reports,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    for vintage, report in reports.items():
        for geo in ("2580", FA):
            s = report["summary"].get(geo)
            if s:
                print(f"SCB {vintage} {geo}: MAPE={s['MAPE']:.3f}% | MAE={s['MAE']:.1f} | mean error={s['meanError']:.1f}")

if __name__ == "__main__":
    main()
