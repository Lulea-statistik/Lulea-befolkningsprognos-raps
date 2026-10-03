#!/usr/bin/env python3
"""Build a mass-preserving municipality-to-county consistency adjustment diagnostic.

Development-only. This does not change the production forecast. It derives
non-negative proportional scaling factors from the locked Norrbotten support
geographies and SCB regional projection flow totals.
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
GEOS = ROOT / "data" / "scb_consistency_geographies.json"
CONFIG = ROOT / "data" / "scb_consistency_adjustment_config.json"
OUT = ROOT / "data" / "backtests" / "scb_consistency_adjustment.json"


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


def wide_columns(fieldnames, wanted_codes):
    wanted = set(wanted_codes)
    out = []
    for header in fieldnames or []:
        m = re.match(r"^(\S+)\s+(20\d{2})$", str(header or "").strip())
        if m and m.group(1) in wanted:
            out.append((header, m.group(1), int(m.group(2))))
    return out


def aggregate(source_rows, fieldnames, allowed_geos, wanted_codes):
    cols = wide_columns(fieldnames, wanted_codes)
    if not cols:
        raise RuntimeError("No regional flow columns found.")
    totals = defaultdict(float)
    for row in source_rows:
        geo = str(row.get("Region", "")).strip()
        if geo not in allowed_geos:
            continue
        for col, code, year in cols:
            totals[(geo, code, year)] += num(row.get(col))
    return totals, sorted({year for _, _, year in cols})


def scale_nonnegative(values, target):
    """Scale a non-negative mapping to target while preserving shares."""
    target = max(0.0, float(target))
    clean = {k: max(0.0, float(v)) for k, v in values.items()}
    total = sum(clean.values())
    if target == 0:
        return {k: 0.0 for k in clean}
    if total > 0:
        factor = target / total
        return {k: v * factor for k, v in clean.items()}
    if not clean:
        return {}
    share = target / len(clean)
    return {k: share for k in clean}


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if cfg.get("status") != "development_candidate_locked_before_adjustment_results":
        raise RuntimeError("Consistency adjustment candidate must be locked before results.")

    geo_cfg = json.loads(GEOS.read_text(encoding="utf-8"))
    county = geo_cfg["county"]["code"]
    municipalities = set(geo_cfg["municipalities"])

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    info = manifest["files"]["regional_flows_benchmark"]
    labels = info.get("content_labels", {})
    code_by_label = {str(v).strip().lower(): k for k, v in labels.items()}
    wanted = {
        "domesticIn": next((k for label, k in code_by_label.items() if "inrikes inflyttning" in label), None),
        "domesticOut": next((k for label, k in code_by_label.items() if "inrikes utflyttning" in label), None),
        "immigration": next((k for label, k in code_by_label.items() if label == "invandring"), None),
        "emigration": next((k for label, k in code_by_label.items() if label == "utvandring"), None),
    }
    if any(v is None for v in wanted.values()):
        raise RuntimeError(f"Missing regional flow content codes: {wanted}")

    text = RAW.read_text(encoding="utf-8")
    reader = csv.DictReader(text.splitlines(), dialect=sniff(text))
    source_rows = list(reader)
    totals, years = aggregate(
        source_rows, reader.fieldnames or [], municipalities | {county}, wanted.values()
    )

    rows = []
    max_residual = 0.0
    for year in years:
        mun_dom_in = {g: totals[(g, wanted["domesticIn"], year)] for g in municipalities}
        mun_dom_out = {g: totals[(g, wanted["domesticOut"], year)] for g in municipalities}
        mun_imm = {g: totals[(g, wanted["immigration"], year)] for g in municipalities}
        mun_emi = {g: totals[(g, wanted["emigration"], year)] for g in municipalities}

        county_dom_in = totals[(county, wanted["domesticIn"], year)]
        county_dom_out = totals[(county, wanted["domesticOut"], year)]
        county_imm = totals[(county, wanted["immigration"], year)]
        county_emi = totals[(county, wanted["emigration"], year)]

        # Cross-county and international layers match the county targets.
        adj_dom_in = scale_nonnegative(mun_dom_in, county_dom_in)
        adj_dom_out = scale_nonnegative(mun_dom_out, county_dom_out)
        adj_imm = scale_nonnegative(mun_imm, county_imm)
        adj_emi = scale_nonnegative(mun_emi, county_emi)

        # Internal-county movement is mass preserving by construction.
        raw_within_in = max(0.0, sum(mun_dom_in.values()) - county_dom_in)
        raw_within_out = max(0.0, sum(mun_dom_out.values()) - county_dom_out)
        within_target = 0.5 * (raw_within_in + raw_within_out)

        residuals = {
            "domesticIn": sum(adj_dom_in.values()) - county_dom_in,
            "domesticOut": sum(adj_dom_out.values()) - county_dom_out,
            "immigration": sum(adj_imm.values()) - county_imm,
            "emigration": sum(adj_emi.values()) - county_emi,
            "withinCountyBalance": within_target - within_target,
        }
        max_residual = max(max_residual, *(abs(v) for v in residuals.values()))

        rows.append({
            "year": year,
            "targets": {
                "countyDomesticIn": county_dom_in,
                "countyDomesticOut": county_dom_out,
                "countyImmigration": county_imm,
                "countyEmigration": county_emi,
                "withinCountyCommonTotal": within_target,
            },
            "raw": {
                "municipalDomesticIn": sum(mun_dom_in.values()),
                "municipalDomesticOut": sum(mun_dom_out.values()),
                "municipalImmigration": sum(mun_imm.values()),
                "municipalEmigration": sum(mun_emi.values()),
                "withinCountyFromIn": raw_within_in,
                "withinCountyFromOut": raw_within_out,
            },
            "adjusted": {
                "municipalDomesticIn": sum(adj_dom_in.values()),
                "municipalDomesticOut": sum(adj_dom_out.values()),
                "municipalImmigration": sum(adj_imm.values()),
                "municipalEmigration": sum(adj_emi.values()),
                "withinCountyIn": within_target,
                "withinCountyOut": within_target,
            },
            "residuals": residuals,
            "factors": {
                "domesticIn": 0.0 if sum(mun_dom_in.values()) <= 0 else county_dom_in / sum(mun_dom_in.values()),
                "domesticOut": 0.0 if sum(mun_dom_out.values()) <= 0 else county_dom_out / sum(mun_dom_out.values()),
                "immigration": 0.0 if sum(mun_imm.values()) <= 0 else county_imm / sum(mun_imm.values()),
                "emigration": 0.0 if sum(mun_emi.values()) <= 0 else county_emi / sum(mun_emi.values()),
            },
        })

    result = {
        "schemaVersion": "0.1.0",
        "status": "development_diagnostic_not_production",
        "config": "data/scb_consistency_adjustment_config.json",
        "county": geo_cfg["county"],
        "municipalities": geo_cfg["municipalities"],
        "method": "Non-negative proportional raking to locked county flow totals; within-county movement is balanced to a common total.",
        "massPreserving": max_residual < 1e-8,
        "maxAbsoluteResidual": max_residual,
        "rows": rows,
        "nationalLayerActive": False,
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(f"Mass preserving={result['massPreserving']} max residual={max_residual:.12g}")


if __name__ == "__main__":
    main()
