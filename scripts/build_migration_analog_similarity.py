#!/usr/bin/env python3
"""Build a pre-declared migration analogue similarity index for Luleå.

The candidate pool and weights are locked in data/migration_analog_municipalities.json
before scores are generated. The index is descriptive only and is not yet used
by the production forecast.
"""
from __future__ import annotations

import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

import build_model_data as b

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "data" / "migration_analog_municipalities.json"
OUT = ROOT / "data" / "backtests" / "migration_analog_similarity.json"


def rms(values):
    vals = [float(v) for v in values]
    return math.sqrt(sum(v * v for v in vals) / len(vals)) if vals else 0.0


def robust_scale(values):
    vals = [float(v) for v in values]
    if not vals:
        return 1.0
    med = statistics.median(vals)
    mad = statistics.median(abs(v - med) for v in vals)
    if mad > 0:
        return 1.4826 * mad
    if len(vals) > 1:
        sd = statistics.pstdev(vals)
        if sd > 0:
            return sd
    return 1.0


def standardized_group_distance(vectors, target, candidate, keys):
    diffs = []
    for key in keys:
        vals = [vectors[geo][key] for geo in vectors]
        scale = robust_scale(vals)
        diffs.append((vectors[candidate][key] - vectors[target][key]) / scale)
    return rms(diffs)


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if cfg.get("status") != "candidate_pool_locked_before_similarity_results":
        raise RuntimeError("Migration analogue candidate pool must be locked before scoring.")

    target = cfg["target"]["code"]
    candidates = list((cfg.get("candidates") or {}).keys())
    geos = [target] + candidates
    years = set(int(y) for y in cfg["index"]["calibrationYears"])

    pop = b.load_wide_age_sex(
        "population_pre2025.csv",
        allowed_geos=set(geos),
    )
    inflow = b.load_wide_age_sex(
        "migration_pre2025.csv",
        b.IN_MIG_CODES,
        allowed_geos=set(geos),
    )
    outflow = b.load_wide_age_sex(
        "migration_pre2025.csv",
        b.OUT_MIG_CODES,
        allowed_geos=set(geos),
    )

    missing = [
        geo for geo in geos
        if not any(k[0] == geo and k[1] in years for k in pop)
    ]
    if missing:
        result = {
            "schemaVersion": "0.1.0",
            "status": "awaiting_full_scb_refresh",
            "missingGeographies": missing,
            "candidatePool": cfg["candidates"],
            "note": "Run Update SCB data in full mode so the locked analogue municipalities are added to the historical extracts.",
        }
        OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Analogue index awaiting SCB refresh: " + ", ".join(missing))
        return

    # Aggregate sex-specific source tables to age/year totals.
    p = defaultdict(float)
    mi = defaultdict(float)
    mo = defaultdict(float)
    for (geo, year, _sex, age), value in pop.items():
        if geo in geos and year in years and 0 <= age <= 100:
            p[(geo, year, age)] += value
    for (geo, year, _sex, age), value in inflow.items():
        if geo in geos and year in years and 0 <= age <= 100:
            mi[(geo, year, age)] += value
    for (geo, year, _sex, age), value in outflow.items():
        if geo in geos and year in years and 0 <= age <= 100:
            mo[(geo, year, age)] += value

    vectors = {}
    group_keys = {
        "log_population": ["log_population"],
        "share_age_18_29": ["share_age_18_29"],
        "age_structure_15_39": [f"age_share_{age}" for age in range(15, 40)],
        "in_migration_age_profile_15_39": [f"in_rate_{age}" for age in range(15, 40)],
        "out_migration_age_profile_15_39": [f"out_rate_{age}" for age in range(15, 40)],
        "young_adult_migration_volatility": ["young_migration_volatility"],
    }

    for geo in geos:
        annual_population = {}
        annual_young_share = {}
        annual_young_migration_rate = {}
        age_pop_sum = defaultdict(float)
        age_in_sum = defaultdict(float)
        age_out_sum = defaultdict(float)
        age_exposure_sum = defaultdict(float)

        for year in sorted(years):
            total = sum(p[(geo, year, age)] for age in range(101))
            young = sum(p[(geo, year, age)] for age in range(18, 30))
            annual_population[year] = total
            annual_young_share[year] = 0.0 if total <= 0 else young / total
            young_in = sum(mi[(geo, year, age)] for age in range(18, 30))
            young_out = sum(mo[(geo, year, age)] for age in range(18, 30))
            annual_young_migration_rate[year] = (
                0.0 if young <= 0 else (young_in + young_out) / young
            )
            for age in range(15, 40):
                exposure = p[(geo, year, age)]
                age_pop_sum[age] += exposure
                age_in_sum[age] += mi[(geo, year, age)]
                age_out_sum[age] += mo[(geo, year, age)]
                age_exposure_sum[age] += exposure

        mean_population = statistics.mean(annual_population.values())
        profile_total = sum(age_pop_sum.values())
        vec = {
            "log_population": math.log(max(1.0, mean_population)),
            "share_age_18_29": statistics.mean(annual_young_share.values()),
            "young_migration_volatility": (
                statistics.pstdev(annual_young_migration_rate.values())
                if len(annual_young_migration_rate) > 1 else 0.0
            ),
        }
        for age in range(15, 40):
            exposure = age_exposure_sum[age]
            vec[f"age_share_{age}"] = (
                0.0 if profile_total <= 0 else age_pop_sum[age] / profile_total
            )
            vec[f"in_rate_{age}"] = (
                0.0 if exposure <= 0 else age_in_sum[age] / exposure
            )
            vec[f"out_rate_{age}"] = (
                0.0 if exposure <= 0 else age_out_sum[age] / exposure
            )
        vectors[geo] = vec

    weights = {
        row["key"]: float(row["weight"])
        for row in cfg["index"]["features"]
    }
    rows = []
    for geo in candidates:
        components = {}
        for feature, keys in group_keys.items():
            components[feature] = standardized_group_distance(
                vectors, target, geo, keys
            )
        distance = math.sqrt(sum(
            weights[k] * components[k] * components[k]
            for k in components
        ))
        rows.append({
            "geo": geo,
            "name": cfg["candidates"][geo],
            "distance": distance,
            "similarityScore": 100.0 / (1.0 + distance),
            "components": components,
        })

    rows.sort(key=lambda r: (r["distance"], r["geo"]))
    for rank, row in enumerate(rows, 1):
        row["rank"] = rank
        row["distance"] = round(row["distance"], 6)
        row["similarityScore"] = round(row["similarityScore"], 2)
        row["components"] = {
            k: round(v, 6) for k, v in row["components"].items()
        }

    result = {
        "schemaVersion": "0.1.0",
        "status": "diagnostic_only_not_active_in_forecast",
        "config": "data/migration_analog_municipalities.json",
        "target": cfg["target"],
        "calibrationYears": sorted(years),
        "method": cfg["index"],
        "ranking": rows,
        "governance": cfg["governance"],
        "nextAction": "Use a pre-declared top-k analogue pool only in rolling-origin smoothing diagnostics; do not activate in production from this ranking alone.",
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    for row in rows:
        print(
            f"{row['rank']:>2}. {row['name']} ({row['geo']}): "
            f"score={row['similarityScore']:.2f}"
        )


if __name__ == "__main__":
    main()
