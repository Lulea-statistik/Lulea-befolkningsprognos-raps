#!/usr/bin/env python3
"""Diagnose SCB municipality-to-county consistency identities.

Diagnostic only; this does not alter the production forecast.

TAB698 is a wide PxWeb extract: content code and year are encoded in each value
column name, for example 000004LH 2026. Municipal domestic flows include moves
within the county, while county domestic flows include only moves across the
county boundary. Therefore:

    sum municipal domestic in - county domestic in
  = sum municipal domestic out - county domestic out

Both sides represent within-county moves counted once. Municipal immigration
and emigration should likewise reconcile to the county totals after SCB's
hierarchical consistency adjustment.
"""
from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "regional_flows_benchmark.csv"
MANIFEST = ROOT / "data" / "raw" / "manifest.json"
CONFIG = ROOT / "data" / "scb_consistency_geographies.json"
OUT = ROOT / "data" / "backtests" / "scb_consistency_diagnostic.json"


def sniff(text: str):
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


def wide_flow_columns(fieldnames, wanted_codes):
    """Return (column, content-code, year) for wide TAB698 value columns."""
    wanted = set(wanted_codes)
    result = []
    for header in fieldnames or []:
        m = re.match(r"^(\S+)\s+(20\d{2})$", str(header or "").strip())
        if not m:
            continue
        code, year = m.group(1), int(m.group(2))
        if code in wanted:
            result.append((header, code, year))
    return result


def aggregate_wide_flows(source_rows, fieldnames, allowed_geos, wanted_codes):
    """Aggregate age/sex rows to geography x flow-code x year totals."""
    columns = wide_flow_columns(fieldnames, wanted_codes)
    if not columns:
        raise RuntimeError(
            "No TAB698 flow columns found. Expected headers such as "
            "'000004LH 2026'."
        )
    totals = defaultdict(float)
    allowed = set(allowed_geos)
    for row in source_rows:
        geo = str(row.get("Region", "")).strip()
        if geo not in allowed:
            continue
        for col, code, year in columns:
            totals[(geo, code, year)] += num(row.get(col))
    return totals, sorted({year for _, _, year in columns})


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if cfg.get("status") != "support_geographies_locked_before_consistency_results":
        raise RuntimeError(
            "Consistency support geographies must be locked before diagnostics."
        )

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    info = manifest["files"]["regional_flows_benchmark"]
    labels = info.get("content_labels", {})
    code_by_label = {
        str(v).strip().lower(): k for k, v in labels.items()
    }

    wanted = {
        "domesticIn": next(
            (k for label, k in code_by_label.items()
             if "inrikes inflyttning" in label),
            None,
        ),
        "domesticOut": next(
            (k for label, k in code_by_label.items()
             if "inrikes utflyttning" in label),
            None,
        ),
        "immigration": next(
            (k for label, k in code_by_label.items()
             if label == "invandring"),
            None,
        ),
        "emigration": next(
            (k for label, k in code_by_label.items()
             if label == "utvandring"),
            None,
        ),
    }
    if any(v is None for v in wanted.values()):
        raise RuntimeError(f"Missing regional flow content codes: {wanted}")

    county = cfg["county"]["code"]
    municipalities = set(cfg["municipalities"])
    available = set(info.get("selection", {}).get("Region", []))
    missing = ({county} | municipalities) - available
    if missing:
        raise RuntimeError(
            "Regional flow benchmark is missing consistency geographies: "
            + ", ".join(sorted(missing))
        )

    text = RAW.read_text(encoding="utf-8")
    reader = csv.DictReader(text.splitlines(), dialect=sniff(text))
    source_rows = list(reader)
    fields = reader.fieldnames or []
    allowed = municipalities | {county}
    totals, years = aggregate_wide_flows(
        source_rows, fields, allowed, wanted.values()
    )

    rows = []
    for year in years:
        mun_in = sum(
            totals[(g, wanted["domesticIn"], year)]
            for g in municipalities
        )
        mun_out = sum(
            totals[(g, wanted["domesticOut"], year)]
            for g in municipalities
        )
        county_in = totals[(county, wanted["domesticIn"], year)]
        county_out = totals[(county, wanted["domesticOut"], year)]
        within_from_in = mun_in - county_in
        within_from_out = mun_out - county_out

        mun_imm = sum(
            totals[(g, wanted["immigration"], year)]
            for g in municipalities
        )
        county_imm = totals[(county, wanted["immigration"], year)]
        mun_emi = sum(
            totals[(g, wanted["emigration"], year)]
            for g in municipalities
        )
        county_emi = totals[(county, wanted["emigration"], year)]

        rows.append({
            "year": year,
            "municipalDomesticIn": mun_in,
            "countyDomesticIn": county_in,
            "municipalDomesticOut": mun_out,
            "countyDomesticOut": county_out,
            "withinCountyFromIn": within_from_in,
            "withinCountyFromOut": within_from_out,
            "withinCountyDifference": within_from_in - within_from_out,
            "municipalImmigration": mun_imm,
            "countyImmigration": county_imm,
            "immigrationDifference": mun_imm - county_imm,
            "municipalEmigration": mun_emi,
            "countyEmigration": county_emi,
            "emigrationDifference": mun_emi - county_emi,
        })

    if not rows or not any(
        r["municipalDomesticIn"] > 0 or r["municipalDomesticOut"] > 0
        for r in rows
    ):
        raise RuntimeError(
            "TAB698 consistency diagnostic produced no non-zero domestic flows."
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    out = {
        "schemaVersion": "0.2.0",
        "status": "diagnostic_only",
        "source": "SCB TAB698 regional population projection flows",
        "sourceFormat": "wide content-code x year columns",
        "county": cfg["county"],
        "municipalities": cfg["municipalities"],
        "method": (
            "Checks municipality-to-county accounting identities that the "
            "later SCB-style hierarchical consistency layer must reproduce."
        ),
        "rows": rows,
        "maxAbsoluteWithinCountyDifference": max(
            (abs(r["withinCountyDifference"]) for r in rows), default=0.0
        ),
        "maxAbsoluteImmigrationDifference": max(
            (abs(r["immigrationDifference"]) for r in rows), default=0.0
        ),
        "maxAbsoluteEmigrationDifference": max(
            (abs(r["emigrationDifference"]) for r in rows), default=0.0
        ),
        "productionDefaultChanged": False,
    }
    OUT.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(
        "Max abs differences: "
        f"within-county={out['maxAbsoluteWithinCountyDifference']:.6f}, "
        f"immigration={out['maxAbsoluteImmigrationDifference']:.6f}, "
        f"emigration={out['maxAbsoluteEmigrationDifference']:.6f}"
    )


if __name__ == "__main__":
    main()
