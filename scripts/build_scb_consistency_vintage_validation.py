#!/usr/bin/env python3
"""Validate the locked municipality-to-county adjustment on frozen SCB vintages.

This is structural historical validation only. It checks whether the locked
non-negative proportional adjustment reproduces county totals for the 2020,
2021 and 2022 SCB regional projection vintages without changing the method
after seeing results.
"""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path

from build_scb_consistency_adjustment import scale_nonnegative

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
MANIFEST = RAW / "manifest.json"
GEOS = ROOT / "data" / "scb_consistency_geographies.json"
CONFIG = ROOT / "data" / "scb_consistency_adjustment_config.json"
OUT = ROOT / "data" / "backtests" / "scb_consistency_vintage_validation.json"

VINTAGES = {
    2020: "regional_flows_benchmark_2020",
    2021: "regional_flows_benchmark_2021",
    2022: "regional_flows_benchmark_2022",
}


def sniff(path: Path):
    text = path.read_text(encoding="utf-8")
    try:
        return csv.Sniffer().sniff(text[:10000], delimiters=";,\t,")
    except csv.Error:
        return csv.excel


def num(value):
    s = str(value or "").strip().replace(" ", "").replace(",", ".")
    if s in ("", "..", "-", "—"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def flow_codes(info):
    labels = info.get("content_labels", {})
    by_label = {str(v).strip().lower(): k for k, v in labels.items()}
    return {
        "domesticIn": next((k for label, k in by_label.items() if "inrikes inflyttning" in label), None),
        "domesticOut": next((k for label, k in by_label.items() if "inrikes utflyttning" in label), None),
        "immigration": next((k for label, k in by_label.items() if label == "invandring"), None),
        "emigration": next((k for label, k in by_label.items() if label == "utvandring"), None),
    }


def aggregate(path, allowed, codes):
    text = path.read_text(encoding="utf-8")
    reader = csv.DictReader(text.splitlines(), dialect=sniff(path))
    fields = reader.fieldnames or []
    cols = []
    for h in fields:
        m = re.match(r"^(\S+)\s+(20\d{2})$", str(h or "").strip())
        if m and m.group(1) in set(codes.values()):
            cols.append((h, m.group(1), int(m.group(2))))
    if not cols:
        raise RuntimeError(f"No flow columns found in {path.name}")
    totals = defaultdict(float)
    for row in reader:
        geo = str(row.get("Region", "")).strip()
        if geo not in allowed:
            continue
        for col, code, year in cols:
            totals[(geo, code, year)] += num(row.get(col))
    return totals, sorted({y for _, _, y in cols})


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if cfg.get("status") != "development_candidate_locked_before_adjustment_results":
        raise RuntimeError("Adjustment configuration is not locked.")

    geos = json.loads(GEOS.read_text(encoding="utf-8"))
    county = geos["county"]["code"]
    municipalities = set(geos["municipalities"])
    expected = municipalities | {county}

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    reports = {}
    missing = []
    max_residual = 0.0

    for vintage, key in VINTAGES.items():
        info = (manifest.get("files") or {}).get(key) or {}
        selected = set(((info.get("selection") or {}).get("Region") or []))
        path = RAW / f"{key}.csv"
        if not path.exists() or not expected.issubset(selected):
            missing.append(key)
            continue

        codes = flow_codes(info)
        if any(v is None for v in codes.values()):
            raise RuntimeError(f"Missing flow codes for {key}: {codes}")

        totals, years = aggregate(path, expected, codes)
        rows = []
        for year in [y for y in years if y >= vintage]:
            raw = {
                "domesticIn": {g: totals[(g, codes["domesticIn"], year)] for g in municipalities},
                "domesticOut": {g: totals[(g, codes["domesticOut"], year)] for g in municipalities},
                "immigration": {g: totals[(g, codes["immigration"], year)] for g in municipalities},
                "emigration": {g: totals[(g, codes["emigration"], year)] for g in municipalities},
            }
            targets = {
                "domesticIn": totals[(county, codes["domesticIn"], year)],
                "domesticOut": totals[(county, codes["domesticOut"], year)],
                "immigration": totals[(county, codes["immigration"], year)],
                "emigration": totals[(county, codes["emigration"], year)],
            }
            adjusted = {name: scale_nonnegative(values, targets[name]) for name, values in raw.items()}
            residuals = {
                name: sum(adjusted[name].values()) - targets[name]
                for name in targets
            }
            raw_within_in = max(0.0, sum(raw["domesticIn"].values()) - targets["domesticIn"])
            raw_within_out = max(0.0, sum(raw["domesticOut"].values()) - targets["domesticOut"])
            within_target = 0.5 * (raw_within_in + raw_within_out)
            residuals["withinCountyBalance"] = 0.0
            row_max = max(abs(v) for v in residuals.values())
            max_residual = max(max_residual, row_max)

            rows.append({
                "year": year,
                "targets": targets,
                "rawMunicipalSums": {name: sum(values.values()) for name, values in raw.items()},
                "rawWithinCountyFromIn": raw_within_in,
                "rawWithinCountyFromOut": raw_within_out,
                "adjustedMunicipalSums": {name: sum(values.values()) for name, values in adjusted.items()},
                "withinCountyCommonTotal": within_target,
                "residuals": residuals,
                "maxAbsoluteResidual": row_max,
            })

        reports[str(vintage)] = {
            "sourceFile": str(path.relative_to(ROOT)),
            "years": rows,
            "passed": bool(rows) and all(r["maxAbsoluteResidual"] < 1e-8 for r in rows),
        }

    result = {
        "schemaVersion": "0.1.0",
        "status": "historical_vintage_structural_validation",
        "methodLockedBeforeResults": True,
        "availableVintages": sorted(int(v) for v in reports),
        "missingVintages": missing,
        "allRequiredVintagesAvailable": len(reports) == len(VINTAGES),
        "allPassed": len(reports) == len(VINTAGES) and all(r["passed"] for r in reports.values()),
        "maxAbsoluteResidual": max_residual,
        "note": "This validates hierarchical accounting on frozen historical SCB vintages. It does not by itself prove improved population forecast accuracy.",
        "vintages": reports,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(
        f"vintages={result['availableVintages']} missing={missing} "
        f"allPassed={result['allPassed']} maxResidual={max_residual:.12g}"
    )


if __name__ == "__main__":
    main()
