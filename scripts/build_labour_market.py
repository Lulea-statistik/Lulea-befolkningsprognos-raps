#!/usr/bin/env python3
"""Build labour-market/commuting analysis data from SCB TAB1830.

The table describes employed persons by municipality of residence and
municipality of workplace. It is used as an observed commuting/job-residence
pattern, not as direct evidence of residential migration.
"""
from __future__ import annotations

import csv
import io
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "commuting_flows.csv"
OUT_JSON = ROOT / "data" / "labour_market.json"
OUT_JS = ROOT / "data" / "labour_market.js"

MUNICIPALITIES = {
    "2580": "Luleå kommun",
    "2582": "Bodens kommun",
    "2581": "Piteå kommun",
    "2560": "Älvsbyns kommun",
    "2514": "Kalix kommun",
}
OUTSIDE = "OUTSIDE_FA"

def sniff(text: str):
    try:
        return csv.Sniffer().sniff(text[:10000], delimiters=";,\t,")
    except csv.Error:
        return csv.excel

def num(v) -> float:
    s = str(v or "").strip().replace(" ", "").replace(",", ".")
    if s in ("", "..", "-", "—"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0

def municipality_code(v: str) -> str | None:
    s = str(v or "").strip()
    if s in MUNICIPALITIES:
        return s
    m = re.match(r"^(\d{4})\b", s)
    return m.group(1) if m else None

def find_header(fields, needle: str):
    needle = needle.lower()
    for h in fields:
        if needle in str(h).lower():
            return h
    return None

def value_columns(fields):
    out = []
    for h in fields:
        m = re.search(r"(20\d{2})$", h or "")
        if m:
            out.append((h, int(m.group(1))))
    return out

def main():
    if not RAW.exists():
        raise SystemExit(f"Missing {RAW.relative_to(ROOT)}")

    text = RAW.read_text(encoding="utf-8")
    dialect = sniff(text)
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    fields = reader.fieldnames or []

    residence_col = find_header(fields, "bostadskommun")
    workplace_col = find_header(fields, "arbetsställekommun") or find_header(fields, "arbetsstallekommun")
    if not residence_col or not workplace_col:
        raise RuntimeError(
            f"Could not identify residence/workplace municipality columns: {fields!r}"
        )
    year_cols = value_columns(fields)
    if not year_cols:
        raise RuntimeError(f"No year columns found: {fields!r}")

    flows = defaultdict(float)
    for r in reader:
        residence = municipality_code(r.get(residence_col))
        workplace = municipality_code(r.get(workplace_col))
        if not residence or workplace not in MUNICIPALITIES:
            continue
        for col, year in year_cols:
            flows[(year, residence, workplace)] += num(r.get(col))

    years = sorted({y for y, _, _ in flows})
    if not years:
        raise RuntimeError("No commuting observations parsed.")
    latest = max(years)

    workplace_series = []
    residence_shares = []
    workplace_summary = []
    matrix_latest = []

    for workplace in MUNICIPALITIES:
        first_total = None
        last_total = None
        for year in years:
            by_res = defaultdict(float)
            for (yy, residence, ww), value in flows.items():
                if yy == year and ww == workplace:
                    group = residence if residence in MUNICIPALITIES else OUTSIDE
                    by_res[group] += value
            total = sum(by_res.values())
            workplace_series.append({
                "workplace": workplace,
                "year": year,
                "jobs": total,
            })
            if first_total is None:
                first_total = total
            last_total = total

            for group in list(MUNICIPALITIES) + [OUTSIDE]:
                value = by_res.get(group, 0.0)
                residence_shares.append({
                    "workplace": workplace,
                    "year": year,
                    "residence": group,
                    "value": value,
                    "sharePct": 0.0 if total <= 0 else 100.0 * value / total,
                })

            if year == latest:
                local = by_res.get(workplace, 0.0)
                other_fa = sum(v for g, v in by_res.items() if g in MUNICIPALITIES and g != workplace)
                outside = by_res.get(OUTSIDE, 0.0)
                workplace_summary.append({
                    "workplace": workplace,
                    "year": year,
                    "jobs": total,
                    "residentSameMunicipality": local,
                    "residentOtherFA": other_fa,
                    "residentOutsideFA": outside,
                    "sameMunicipalitySharePct": 0.0 if total <= 0 else 100.0 * local / total,
                    "otherFASharePct": 0.0 if total <= 0 else 100.0 * other_fa / total,
                    "outsideFASharePct": 0.0 if total <= 0 else 100.0 * outside / total,
                })
                for group in list(MUNICIPALITIES) + [OUTSIDE]:
                    value = by_res.get(group, 0.0)
                    matrix_latest.append({
                        "residence": group,
                        "workplace": workplace,
                        "year": latest,
                        "value": value,
                        "shareOfWorkplacePct": 0.0 if total <= 0 else 100.0 * value / total,
                    })

        # Add growth summary once all years for the workplace are known.
        summary = next(x for x in workplace_summary if x["workplace"] == workplace)
        summary["jobsFirstYear"] = first_total or 0.0
        summary["jobsLatestYear"] = last_total or 0.0
        summary["jobsChange"] = (last_total or 0.0) - (first_total or 0.0)
        summary["jobsChangePct"] = (
            None if not first_total else 100.0 * ((last_total or 0.0) - first_total) / first_total
        )

    data = {
        "meta": {
            "schemaVersion": "0.1.0",
            "sourceTable": "TAB1830",
            "years": years,
            "latestYear": latest,
            "note": (
                "Commuting/job-residence data. Residence shares describe where current workers live; "
                "they are not direct residential migration probabilities."
            ),
            "qualityNote": (
                "SCB applies disclosure-control/statistical protection, so displayed totals are not always "
                "exactly equal to the sum of displayed parts. From 2024 the method for classifying "
                "entrepreneurs changed, reducing comparability with earlier years."
            ),
        },
        "geographies": [
            {"code": c, "name": n} for c, n in MUNICIPALITIES.items()
        ],
        "outsideGroup": {"code": OUTSIDE, "name": "Utanför Luleå FA"},
        "workplaceSeries": workplace_series,
        "residenceShares": residence_shares,
        "workplaceSummary": workplace_summary,
        "matrixLatest": matrix_latest,
    }

    OUT_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUT_JS.write_text(
        "window.LABOUR_MARKET_DATA = " +
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) +
        ";\n",
        encoding="utf-8",
    )

    print(f"Wrote {OUT_JSON.relative_to(ROOT)} and {OUT_JS.relative_to(ROOT)}")
    for s in workplace_summary:
        print(
            f"{s['workplace']}: jobs={s['jobs']:.0f}, "
            f"same={s['sameMunicipalitySharePct']:.1f}%, "
            f"other_FA={s['otherFASharePct']:.1f}%, "
            f"outside_FA={s['outsideFASharePct']:.1f}%"
        )

if __name__ == "__main__":
    main()
