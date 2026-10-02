#!/usr/bin/env python3
"""Diagnose the SCB municipality-to-county consistency identities.

This is a diagnostic only. It does not alter the production forecast.
For a county, summing municipal domestic in/out flows includes moves between
municipalities inside the county, while county-level domestic flows include
only moves across the county boundary. Therefore:

    sum municipal domestic in - county domestic in
  = sum municipal domestic out - county domestic out

Both quantities represent within-county moves counted once at the destination
or origin municipality respectively.

The same regional projection also requires municipal immigration/emigration to
sum to the county totals. These identities are used to design the later
hierarchical consistency layer without tuning to Lulea forecast errors.
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


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if cfg.get("status") != "support_geographies_locked_before_consistency_results":
        raise RuntimeError("Consistency support geographies must be locked before diagnostics.")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    info = manifest["files"]["regional_flows_benchmark"]
    labels = info.get("content_labels", {})
    code_by_label = {str(v).strip().lower(): k for k, v in labels.items()}

    wanted = {
        "domesticIn": next((k for label,k in code_by_label.items() if "inrikes inflyttning" in label), None),
        "domesticOut": next((k for label,k in code_by_label.items() if "inrikes utflyttning" in label), None),
        "immigration": next((k for label,k in code_by_label.items() if label == "invandring"), None),
        "emigration": next((k for label,k in code_by_label.items() if label == "utvandring"), None),
    }
    if any(v is None for v in wanted.values()):
        raise RuntimeError(f"Missing regional flow content codes: {wanted}")

    text = RAW.read_text(encoding="utf-8")
    reader = csv.DictReader(text.splitlines(), dialect=sniff(text))
    fields = reader.fieldnames or []
    years = []
    for h in fields:
        m = re.search(r"(20\d{2})$", h or "")
        if m:
            years.append((h, int(m.group(1))))
    if not years:
        raise RuntimeError("No forecast years found in regional flow benchmark.")

    county = cfg["county"]["code"]
    municipalities = set(cfg["municipalities"])
    available = set(info.get("selection", {}).get("Region", []))
    missing = ({county} | municipalities) - available
    if missing:
        raise RuntimeError(
            "Regional flow benchmark is missing consistency geographies: " +
            ", ".join(sorted(missing))
        )

    totals = defaultdict(float)
    allowed = municipalities | {county}
    for row in reader:
        geo = row.get("Region")
        if geo not in allowed:
            continue
        content = row.get("ContentsCode")
        if content not in set(wanted.values()):
            continue
        for col, year in years:
            totals[(geo, content, year)] += num(row.get(col))

    rows = []
    for _, year in years:
        mun_in = sum(totals[(g, wanted["domesticIn"], year)] for g in municipalities)
        mun_out = sum(totals[(g, wanted["domesticOut"], year)] for g in municipalities)
        county_in = totals[(county, wanted["domesticIn"], year)]
        county_out = totals[(county, wanted["domesticOut"], year)]
        within_from_in = mun_in - county_in
        within_from_out = mun_out - county_out

        mun_imm = sum(totals[(g, wanted["immigration"], year)] for g in municipalities)
        county_imm = totals[(county, wanted["immigration"], year)]
        mun_emi = sum(totals[(g, wanted["emigration"], year)] for g in municipalities)
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

    OUT.parent.mkdir(parents=True, exist_ok=True)
    out = {
        "schemaVersion": "0.1.0",
        "status": "diagnostic_only",
        "source": "SCB TAB698 regional population projection flows",
        "county": cfg["county"],
        "municipalities": cfg["municipalities"],
        "method": (
            "Checks municipality-to-county accounting identities that the later "
            "SCB-style hierarchical consistency layer must reproduce."
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
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(
        "Max abs differences: "
        f"within-county={out['maxAbsoluteWithinCountyDifference']:.6f}, "
        f"immigration={out['maxAbsoluteImmigrationDifference']:.6f}, "
        f"emigration={out['maxAbsoluteEmigrationDifference']:.6f}"
    )


if __name__ == "__main__":
    main()
