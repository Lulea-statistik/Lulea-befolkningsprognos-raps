#!/usr/bin/env python3
"""External validation of fixed migration-component calibration windows.

The component windows are locked in data/migration_component_windows.json
before external component results are generated. The validation is municipal:
FA totals are intentionally not used because county/rest-of-Sweden gross-flow
definitions can contain internal FA moves, especially for cross-county FAs.

Origins 2018-2021 are evaluated at n+1 and n+2. The fixed component candidate
is compared with a uniform 10-year in/out baseline.
"""
from __future__ import annotations

import json
import statistics
from collections import defaultdict
from pathlib import Path

import build_model_data as b

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "data" / "migration_component_windows.json"
REF_CONFIG = ROOT / "data" / "reference_fa_regions.json"
OUT = ROOT / "data" / "backtests" / "migration_component_external.json"

ORIGINS = (2018, 2019, 2020, 2021)
HORIZONS = (1, 2)


def mean(values):
    return statistics.fmean(values) if values else 0.0


def score(rows):
    if not rows:
        return {"observations": 0, "MAE": None, "meanError": None}
    errors = [r["error"] for r in rows]
    return {
        "observations": len(rows),
        "MAE": round(mean([abs(x) for x in errors]), 1),
        "meanError": round(mean(errors), 1),
    }


def leg_total(data, geo, year, leg, direction):
    return b._migration_leg_total(data, geo, year, leg, direction)


def predicted_mean(data, geo, origin, window, leg, direction):
    years = range(origin - window + 1, origin + 1)
    return mean([leg_total(data, geo, y, leg, direction) for y in years])


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    refs = json.loads(REF_CONFIG.read_text(encoding="utf-8"))

    if cfg.get("status") != "development_candidate_locked_before_external_component_results":
        raise RuntimeError("Migration component windows must be locked before external validation.")

    lulea = "2580"
    external_by_region = {
        code: list(region["members"])
        for code, region in refs["regions"].items()
    }
    external_geos = sorted({
        geo for members in external_by_region.values() for geo in members
    })
    all_geos = [lulea] + external_geos

    legs = b.load_migration_legs(
        "migration_birth_region_pre2025.csv",
        b.MIGRATION_LEG_CODES_PRE2025,
        allowed_geos=all_geos,
    )

    missing = [
        geo for geo in all_geos
        if not any(key[0] == geo for key in legs)
    ]
    if missing:
        raise RuntimeError(
            "Missing migration-leg rows for reference municipalities: " + ", ".join(missing)
        )

    records = []
    directional = []

    for geo in all_geos:
        for origin in ORIGINS:
            for horizon in HORIZONS:
                year = origin + horizon
                actual_total = 0.0
                candidate_total = 0.0
                uniform10_total = 0.0

                for leg, spec in cfg["legs"].items():
                    actual_in = leg_total(legs, geo, year, leg, "in")
                    actual_out = leg_total(legs, geo, year, leg, "out")
                    actual_net = actual_in - actual_out
                    actual_total += actual_net

                    for direction, window_key in (
                        ("in", "inflowWindow"),
                        ("out", "outflowWindow"),
                    ):
                        selected_window = int(spec[window_key])
                        actual = actual_in if direction == "in" else actual_out
                        candidate = predicted_mean(
                            legs, geo, origin, selected_window, leg, direction
                        )
                        uniform10 = predicted_mean(
                            legs, geo, origin, 10, leg, direction
                        )
                        directional.append({
                            "geo": geo,
                            "origin": origin,
                            "horizon": horizon,
                            "year": year,
                            "leg": leg,
                            "direction": direction,
                            "selectedWindow": selected_window,
                            "actual": actual,
                            "candidate": candidate,
                            "uniform10": uniform10,
                            "candidateError": candidate - actual,
                            "uniform10Error": uniform10 - actual,
                        })

                    candidate_in = predicted_mean(
                        legs, geo, origin, int(spec["inflowWindow"]), leg, "in"
                    )
                    candidate_out = predicted_mean(
                        legs, geo, origin, int(spec["outflowWindow"]), leg, "out"
                    )
                    uniform10_in = predicted_mean(legs, geo, origin, 10, leg, "in")
                    uniform10_out = predicted_mean(legs, geo, origin, 10, leg, "out")
                    candidate_total += candidate_in - candidate_out
                    uniform10_total += uniform10_in - uniform10_out

                records.append({
                    "geo": geo,
                    "origin": origin,
                    "horizon": horizon,
                    "year": year,
                    "actualNetMigration": actual_total,
                    "candidateNetMigration": candidate_total,
                    "uniform10NetMigration": uniform10_total,
                    "candidateError": candidate_total - actual_total,
                    "uniform10Error": uniform10_total - actual_total,
                })

    def summarize_geos(geos):
        geos = set(geos)
        result = {}
        for horizon in HORIZONS:
            rr = [r for r in records if r["geo"] in geos and r["horizon"] == horizon]
            cand = [{"error": r["candidateError"]} for r in rr]
            base = [{"error": r["uniform10Error"]} for r in rr]
            improved = sum(
                abs(r["candidateError"]) < abs(r["uniform10Error"]) for r in rr
            )
            tied = sum(
                abs(abs(r["candidateError"]) - abs(r["uniform10Error"])) < 1e-9
                for r in rr
            )
            result[str(horizon)] = {
                "candidate": score(cand),
                "uniform10": score(base),
                "candidateImprovedCases": improved,
                "tiedCases": tied,
                "totalCases": len(rr),
            }
        return result

    directional_summary = {}
    external_set = set(external_geos)
    for leg, spec in cfg["legs"].items():
        directional_summary[leg] = {}
        for direction in ("in", "out"):
            directional_summary[leg][direction] = {}
            for horizon in HORIZONS:
                rr = [
                    r for r in directional
                    if r["geo"] in external_set
                    and r["leg"] == leg
                    and r["direction"] == direction
                    and r["horizon"] == horizon
                ]
                cand = [{"error": r["candidateError"]} for r in rr]
                base = [{"error": r["uniform10Error"]} for r in rr]
                directional_summary[leg][direction][str(horizon)] = {
                    "selectedWindow": int(
                        spec["inflowWindow"] if direction == "in" else spec["outflowWindow"]
                    ),
                    "candidate": score(cand),
                    "uniform10": score(base),
                    "candidateImprovedCases": sum(
                        abs(r["candidateError"]) < abs(r["uniform10Error"]) for r in rr
                    ),
                    "totalCases": len(rr),
                }

    report = {
        "schemaVersion": "0.1.0",
        "governance": {
            "candidateConfig": str(CONFIG.relative_to(ROOT)),
            "candidateLockedBeforeExternalResults": True,
            "luleaUsedForSelection": True,
            "externalMunicipalitiesUsedForSelection": False,
            "productionDefaultChanged": False,
            "note": (
                "External results are confirmatory only. Do not retune the six "
                "component windows after viewing this report and then reuse the "
                "same external municipalities as independent validation."
            ),
        },
        "origins": list(ORIGINS),
        "horizons": list(HORIZONS),
        "candidateWindows": cfg["legs"],
        "luleaDevelopmentCheck": summarize_geos([lulea]),
        "externalPooled": summarize_geos(external_geos),
        "externalByReferenceRegion": {
            code: {
                "name": refs["regions"][code]["name"],
                "municipalities": members,
                "summary": summarize_geos(members),
            }
            for code, members in external_by_region.items()
        },
        "externalDirectionalSummary": directional_summary,
        "records": records,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(json.dumps(report["externalPooled"], ensure_ascii=False))


if __name__ == "__main__":
    main()
