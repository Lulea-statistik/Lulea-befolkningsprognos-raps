#!/usr/bin/env python3
"""Build vintage-correct rolling-origin demographic backtest inputs.

Origins 2018, 2019, 2020 and 2021 use local observations only through the
origin year and the SCB national forecast vintage published in that same year.
Each origin is evaluated for the following three calendar years.

Intermediate model/actual files are written under data/backtests/rolling_work
and are intentionally git-ignored. The scored report is produced separately by
scripts/run_rolling_backtest.js.
"""
from __future__ import annotations

import csv
import json
import math
import re
import statistics
from collections import defaultdict
from pathlib import Path

import build_model_data as b

ROOT = Path(__file__).resolve().parents[1]
OUTDIR = ROOT / "data" / "backtests"
WORKDIR = OUTDIR / "rolling_work"
WORKDIR.mkdir(parents=True, exist_ok=True)

WINDOWS = (3, 6, 10)
MIGRATION_WINDOWS = (2, 3, 4, 6, 10)
HORIZON_YEARS = 3
ORIGINS = {
    2018: {
        "detail_key": "backtest_national_detail_2018",
        "births_key": "backtest_births_2018",
    },
    2019: {
        "detail_key": "backtest_national_detail_2019",
        "births_key": "backtest_births_2019",
    },
    2020: {
        "detail_key": "backtest_national_detail_2020",
        "births_key": "backtest_births_2020",
    },
    2021: {
        "detail_key": "backtest_national_detail_2021",
        "births_key": "backtest_births_2021",
    },
}

CONSISTENCY_GEOS_CONFIG = ROOT / "data" / "scb_consistency_geographies.json"
CONSISTENCY_ADJUSTMENT_CONFIG = ROOT / "data" / "scb_consistency_adjustment_config.json"
CONSISTENCY_VINTAGE_KEYS = {
    2020: "regional_flows_benchmark_2020",
    2021: "regional_flows_benchmark_2021",
}


def _num(value):
    text = str(value or "").strip().replace(" ", "").replace(",", ".")
    if text in ("", "..", "-", "—"):
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _sniff(path):
    text = path.read_text(encoding="utf-8")
    try:
        return csv.Sniffer().sniff(text[:10000], delimiters=";,\t,")
    except csv.Error:
        return csv.excel


def consistency_support_geographies():
    cfg = json.loads(CONSISTENCY_GEOS_CONFIG.read_text(encoding="utf-8"))
    return cfg["county"]["code"], set(cfg["municipalities"])


def regional_consistency_targets(origin, end_year):
    """Frozen SCB county/municipality flow targets for one forecast vintage."""
    key = CONSISTENCY_VINTAGE_KEYS.get(origin)
    if not key:
        return {}
    manifest = json.loads((b.RAW / "manifest.json").read_text(encoding="utf-8"))
    info = (manifest.get("files") or {}).get(key) or {}
    labels = info.get("content_labels") or {}
    by_label = {str(v).strip().lower(): k for k, v in labels.items()}
    codes = {
        "domesticIn": next((k for label, k in by_label.items() if "inrikes inflyttning" in label), None),
        "domesticOut": next((k for label, k in by_label.items() if "inrikes utflyttning" in label), None),
        "immigration": next((k for label, k in by_label.items() if label == "invandring"), None),
        "emigration": next((k for label, k in by_label.items() if label == "utvandring"), None),
    }
    if any(v is None for v in codes.values()):
        raise RuntimeError(f"Missing consistency flow codes for {key}: {codes}")

    county, municipalities = consistency_support_geographies()
    required = municipalities | {county}
    selected = set(((info.get("selection") or {}).get("Region") or []))
    if not required.issubset(selected):
        raise RuntimeError(
            f"Frozen {key} is missing locked Norrbotten consistency geographies."
        )

    path = b.RAW / f"{key}.csv"
    text = path.read_text(encoding="utf-8")
    reader = csv.DictReader(text.splitlines(), dialect=_sniff(path))
    fields = reader.fieldnames or []
    cols = []
    for header in fields:
        match = re.match(r"^(\S+)\s+(20\d{2})$", str(header or "").strip())
        if match and match.group(1) in set(codes.values()):
            cols.append((header, match.group(1), int(match.group(2))))
    totals = defaultdict(float)
    for row in reader:
        geo = str(row.get("Region", "")).strip()
        if geo not in required:
            continue
        for col, code, year in cols:
            if origin < year <= end_year:
                totals[(geo, code, year)] += _num(row.get(col))

    targets = {}
    for year in range(origin + 1, end_year + 1):
        county_in = totals[(county, codes["domesticIn"], year)]
        county_out = totals[(county, codes["domesticOut"], year)]
        municipal_in = sum(totals[(geo, codes["domesticIn"], year)] for geo in municipalities)
        municipal_out = sum(totals[(geo, codes["domesticOut"], year)] for geo in municipalities)
        within_in = max(0.0, municipal_in - county_in)
        within_out = max(0.0, municipal_out - county_out)
        targets[year] = {
            ("rest_sweden", "in"): county_in,
            ("rest_sweden", "out"): county_out,
            ("county", "in"): 0.5 * (within_in + within_out),
            ("county", "out"): 0.5 * (within_in + within_out),
            ("international", "in"): totals[(county, codes["immigration"], year)],
            ("international", "out"): totals[(county, codes["emigration"], year)],
        }
    return targets


def profet_consistency_factor_rows(
    origin,
    end_year,
    profile_geos,
    population_birth_status,
    in_levels,
    out_risks,
    international_in,
    national_exposure,
    national_immigration,
):
    """Build common Norrbotten factors that preserve locked county totals.

    The factors are derived from the unadjusted Profet development candidate
    across all 14 Norrbotten municipalities and frozen county targets from the
    same SCB vintage. They are not used by the production net10 baseline.
    """
    targets = regional_consistency_targets(origin, end_year)
    if not targets:
        return []

    statuses = ("sweden_born", "foreign_born")
    rows = []
    base_totals = {
        (geo, status): sum(
            population_birth_status.get((geo, origin, sex, age, status), 0.0)
            for sex in ("K", "M")
            for age in range(101)
        )
        for geo in profile_geos
        for status in statuses
    }

    level_map = {
        (r["geo"], r["status"], r["leg"]): float(r.get("value") or 0.0)
        for r in in_levels
        if r["geo"] in profile_geos
    }
    intl_share_map = {}
    for r in international_in:
        if r["geo"] not in profile_geos:
            continue
        key = (r["geo"], r["status"])
        intl_share_map[key] = max(
            intl_share_map.get(key, 0.0),
            float(r.get("municipalityShare") or 0.0),
        )

    out_expected = defaultdict(float)
    for r in out_risks:
        geo = r["geo"]
        if geo not in profile_geos:
            continue
        pop = population_birth_status.get(
            (geo, origin, r["sex"], int(r["age"]), r["status"]), 0.0
        )
        out_expected[(r["leg"], r["status"])] += (
            max(0.0, float(r.get("value") or 0.0)) * max(0.0, pop)
        )

    for year in range(origin + 1, end_year + 1):
        expected = defaultdict(float)
        for geo in profile_geos:
            for status in statuses:
                national_pop = sum(
                    value
                    for (y, st, _sex, _age), value in national_exposure.items()
                    if y == year and st == status
                )
                rest_pop = max(0.0, national_pop - base_totals[(geo, status)])
                for leg in ("county", "rest_sweden"):
                    expected[(leg, "in")] += (
                        max(0.0, level_map.get((geo, status, leg), 0.0))
                        * rest_pop
                    )
                expected[("international", "in")] += (
                    max(0.0, national_immigration.get((year, status), 0.0))
                    * max(0.0, intl_share_map.get((geo, status), 0.0))
                )

        for leg in ("county", "rest_sweden", "international"):
            expected[(leg, "out")] = sum(
                value
                for (l, _status), value in out_expected.items()
                if l == leg
            )

        for leg in ("county", "rest_sweden", "international"):
            for direction in ("in", "out"):
                target = max(0.0, targets[year][(leg, direction)])
                model_expected = max(0.0, expected[(leg, direction)])
                factor = 1.0 if model_expected <= 0 else target / model_expected
                rows.append({
                    "year": year,
                    "leg": leg,
                    "direction": direction,
                    "value": factor,
                    "target": target,
                    "modelExpected": model_expected,
                    "source": "locked Norrbotten municipality-to-county consistency adjustment",
                })
    return rows



def historical_population():
    return b.aggregate_fa_age_sex(
        b.load_wide_age_sex("population_pre2025.csv")
    )


def base_population(pop, year):
    result = []
    for geo in list(b.MUNICIPALITIES) + [b.FA_CODE]:
        for sex in ("K", "M"):
            for age in range(101):
                result.append({
                    "geo": geo,
                    "year": year,
                    "sex": sex,
                    "age": age,
                    "value": pop.get((geo, year, sex, age), 0.0),
                })
    return result


def annual_actuals(pop, births, deaths, inflow, outflow, netmig, origin, end_year):
    result = []
    for geo in list(b.MUNICIPALITIES) + [b.FA_CODE]:
        for year in range(origin + 1, end_year + 1):
            result.append({
                "geo": geo,
                "year": year,
                "horizon": year - origin,
                "population": sum(
                    pop.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M") for age in range(101)
                ),
                "births": sum(
                    births.get((geo, year, age), 0.0)
                    for age in range(15, 50)
                ),
                "deaths": sum(
                    deaths.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M") for age in range(101)
                ),
                "grossInMigration": sum(
                    inflow.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M") for age in range(101)
                ),
                "grossOutMigration": sum(
                    outflow.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M") for age in range(101)
                ),
                "netMigration": sum(
                    netmig.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M") for age in range(101)
                ),
            })
    return result


def national_assumption_rows_from_counts(
    origin,
    end_year,
    forecast_births,
    forecast_deaths,
    actual_births,
    actual_deaths,
):
    """Compare the SCB national forecast vintage with realized Sweden totals.

    This diagnostic separates errors already present in the national forecast
    vintage from errors introduced when the national age profiles are localized
    to the municipalities.
    """
    result = []
    for year in range(origin + 1, end_year + 1):
        predicted_births = sum(
            forecast_births.get((year, age), 0.0)
            for age in range(15, 50)
        )
        observed_births = sum(
            actual_births.get((b.RIKET_CODE, year, age), 0.0)
            for age in range(15, 50)
        )
        predicted_deaths = sum(
            forecast_deaths.get((year, sex, age), 0.0)
            for sex in ("K", "M") for age in range(101)
        )
        observed_deaths = sum(
            actual_deaths.get((b.RIKET_CODE, year, sex, age), 0.0)
            for sex in ("K", "M") for age in range(101)
        )
        result.append({
            "year": year,
            "horizon": year - origin,
            "predictedBirths": predicted_births,
            "actualBirths": observed_births,
            "birthsError": predicted_births - observed_births,
            "predictedDeaths": predicted_deaths,
            "actualDeaths": observed_deaths,
            "deathsError": predicted_deaths - observed_deaths,
        })
    return result


def national_only_fertility_rows(future_fert, start_year, end_year):
    """Build a no-localization fertility alternative for diagnostics only.

    Every forecast geography receives the same SCB national age-specific
    fertility rate for each forecast year. Rows are duplicated across the
    3/6/10 calibration windows so the ordinary model engine can be reused.
    """
    result = []
    geos = [*b.MUNICIPALITIES, b.FA_CODE]
    for geo in geos:
        for window in WINDOWS:
            for (year, age), rate in future_fert.items():
                if year < start_year or year > end_year:
                    continue
                result.append({
                    "geo": geo,
                    "window": window,
                    "year": year,
                    "age": age,
                    "value": max(0.0, float(rate or 0.0)),
                    "source": "SCB national forecast fertility; no local multiplier",
                })
    return result



def _rms(values):
    vals = [float(v) for v in values]
    return math.sqrt(sum(v * v for v in vals) / len(vals)) if vals else 0.0


def _robust_scale(values):
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


def rolling_analogue_ranking(pop, inflow, outflow, origin, config):
    """Re-rank the locked analogue pool using only information through origin."""
    target = config["target"]["code"]
    candidates = list((config.get("candidates") or {}).keys())
    geos = [target] + candidates
    history_len = len(config["index"]["calibrationYears"])
    min_history = int(
        config["smoothingCandidate"]["backtestSelection"]["minimumHistoryYears"]
    )
    start = max(2006, origin - history_len + 1)
    years = list(range(start, origin + 1))
    if len(years) < min_history:
        raise RuntimeError(
            f"Need at least {min_history} history years for analogue ranking at {origin}."
        )

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
        for year in years:
            total = sum(
                pop.get((geo, year, sex, age), 0.0)
                for sex in ("K", "M") for age in range(101)
            )
            young = sum(
                pop.get((geo, year, sex, age), 0.0)
                for sex in ("K", "M") for age in range(18, 30)
            )
            annual_population[year] = total
            annual_young_share[year] = 0.0 if total <= 0 else young / total
            young_in = sum(
                inflow.get((geo, year, sex, age), 0.0)
                for sex in ("K", "M") for age in range(18, 30)
            )
            young_out = sum(
                outflow.get((geo, year, sex, age), 0.0)
                for sex in ("K", "M") for age in range(18, 30)
            )
            annual_young_migration_rate[year] = (
                0.0 if young <= 0 else (young_in + young_out) / young
            )
            for age in range(15, 40):
                exposure = sum(
                    pop.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M")
                )
                age_pop_sum[age] += exposure
                age_in_sum[age] += sum(
                    inflow.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M")
                )
                age_out_sum[age] += sum(
                    outflow.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M")
                )
                age_exposure_sum[age] += exposure

        if not annual_population or statistics.fmean(annual_population.values()) <= 0:
            raise RuntimeError(f"Missing analogue population history for {geo} at {origin}.")
        profile_total = sum(age_pop_sum.values())
        vec = {
            "log_population": math.log(
                max(1.0, statistics.fmean(annual_population.values()))
            ),
            "share_age_18_29": statistics.fmean(annual_young_share.values()),
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
        for row in config["index"]["features"]
    }
    rows = []
    for geo in candidates:
        components = {}
        for feature, keys in group_keys.items():
            diffs = []
            for key in keys:
                scale = _robust_scale([vectors[g][key] for g in geos])
                diffs.append((vectors[geo][key] - vectors[target][key]) / scale)
            components[feature] = _rms(diffs)
        distance = math.sqrt(sum(
            weights[k] * components[k] * components[k]
            for k in components
        ))
        rows.append({
            "geo": geo,
            "name": config["candidates"][geo],
            "distance": distance,
            "similarityScore": 100.0 / (1.0 + distance),
        })
    rows.sort(key=lambda r: (r["distance"], r["geo"]))
    top_k = int(config["smoothingCandidate"]["backtestSelection"]["topK"])
    return rows[:top_k]


def _all_leg_event(pre2025, geo, year, sex, age, direction):
    return sum(
        pre2025.get((geo, year, sex, age, leg, direction), 0.0)
        for leg in b.MIGRATION_LEG_LABELS
    )


def smoothed_net_rows_from_diagnostic(diag, geo="2580"):
    """Convert local+national smoothed gross profiles into a net age/sex profile."""
    selected = [
        r for r in (diag.get("rows") or [])
        if r.get("geo") == geo and r.get("leg") == "all"
    ]
    by_cell = defaultdict(dict)
    for row in selected:
        by_cell[(row["sex"], int(row["age"]))][row["direction"]] = float(
            row.get("smoothedMeanPersons") or 0.0
        )
    result = []
    for sex in ("K", "M"):
        for age in range(101):
            values = by_cell[(sex, age)]
            result.append({
                "geo": geo,
                "window": 10,
                "year": "BASE",
                "sex": sex,
                "age": age,
                "value": values.get("in", 0.0) - values.get("out", 0.0),
                "source": "adaptive local+national age smoothing; gross totals preserved",
            })
    return result


def analogue_smoothed_net_rows(
    pre2025, base_diag, ranking, analogue_config, geo="2580"
):
    """Extend the locked adaptive smoothing target with analogue curvature."""
    smoothing = analogue_config["smoothingCandidate"]["structuralTarget"]
    blend = smoothing["curvatureBlend"]
    national_weight = float(blend["nationalWeight"])
    analogue_weight = float(blend["analogueWeight"])
    profile_window = int(base_diag["window"])
    radius = int(base_diag["neighborRadius"])
    years = list(b.window_years(profile_window))

    selected = [
        r for r in (base_diag.get("rows") or [])
        if r.get("geo") == geo and r.get("leg") == "all"
    ]
    base_map = {
        (r["direction"], r["sex"], int(r["age"])): r
        for r in selected
    }
    score_sum = sum(max(0.0, float(r["similarityScore"])) for r in ranking)
    analogue_weights = {
        r["geo"]: (
            max(0.0, float(r["similarityScore"])) / score_sum
            if score_sum > 0 else 1.0 / max(1, len(ranking))
        )
        for r in ranking
    }

    persons_by_direction = {}
    audit = []
    for direction in ("in", "out"):
        analogue_share = defaultdict(float)
        for analogue_geo, weight in analogue_weights.items():
            total = sum(
                _all_leg_event(pre2025, analogue_geo, year, sex, age, direction)
                for year in years for sex in ("K", "M") for age in range(101)
            )
            for sex in ("K", "M"):
                for age in range(101):
                    events = sum(
                        _all_leg_event(
                            pre2025, analogue_geo, year, sex, age, direction
                        )
                        for year in years
                    )
                    share = 0.0 if total <= 0 else events / total
                    analogue_share[(sex, age)] += weight * share

        candidates = {}
        for sex in ("K", "M"):
            for age in range(101):
                row = base_map[(direction, sex, age)]
                analogue_neighbors = []
                for delta in range(-radius, radius + 1):
                    if delta == 0:
                        continue
                    other = age + delta
                    if 0 <= other <= 100:
                        analogue_neighbors.append(analogue_share[(sex, other)])
                analogue_neighbor = (
                    statistics.fmean(analogue_neighbors)
                    if analogue_neighbors else analogue_share[(sex, age)]
                )
                analogue_curvature = (
                    analogue_share[(sex, age)] - analogue_neighbor
                )
                target = max(
                    0.0,
                    float(row["neighborLocalShare"])
                    + national_weight * float(row["nationalCurvature"])
                    + analogue_weight * analogue_curvature,
                )
                retention = float(row["localRetentionWeight"])
                smooth_weight = float(row["smoothingWeight"])
                candidate = max(
                    0.0,
                    retention * float(row["rawShare"])
                    + smooth_weight * target,
                )
                candidates[(sex, age)] = candidate
                audit.append({
                    "direction": direction,
                    "sex": sex,
                    "age": age,
                    "analogueShare": analogue_share[(sex, age)],
                    "analogueCurvature": analogue_curvature,
                    "structuralTargetShare": target,
                    "localRetentionWeight": retention,
                })

        total_candidate = sum(candidates.values())
        annual_total = sum(
            _all_leg_event(pre2025, geo, year, sex, age, direction)
            for year in years for sex in ("K", "M") for age in range(101)
        ) / float(profile_window)
        persons_by_direction[direction] = {
            cell: (
                annual_total * (
                    float(base_map[(direction, cell[0], cell[1])]["rawShare"])
                    if total_candidate <= 0
                    else value / total_candidate
                )
            )
            for cell, value in candidates.items()
        }

    result = []
    for sex in ("K", "M"):
        for age in range(101):
            result.append({
                "geo": geo,
                "window": 10,
                "year": "BASE",
                "sex": sex,
                "age": age,
                "value": (
                    persons_by_direction["in"][(sex, age)]
                    - persons_by_direction["out"][(sex, age)]
                ),
                "source": "adaptive local+national+analogue smoothing; gross totals preserved",
            })
    return result, audit


def national_only_mortality_rows(future_mort, start_year, end_year):
    """Build a no-localization mortality alternative for diagnostics only.

    Every municipality receives the same SCB national age/sex hazard for each
    forecast year. The rows are duplicated across calibration windows so the
    ordinary model engine can be reused without changing production behavior.
    """
    result = []
    for geo in b.MUNICIPALITIES:
        for window in WINDOWS:
            for (year, sex, age), hazard in future_mort.items():
                if year < start_year or year > end_year:
                    continue
                risk = 1.0 - math.exp(-max(0.0, float(hazard or 0.0)))
                result.append({
                    "geo": geo,
                    "window": window,
                    "year": year,
                    "sex": sex,
                    "age": age,
                    "value": max(0.0, min(1.0, risk)),
                    "source": "SCB national forecast mortality; no local multiplier",
                })
    return result


def build_origin(
    origin, cfg, pop, birth_year_exposure, fertility_exposure, deaths, births,
    inflow, outflow, netmig, migration_legs, population_birth_status,
    migration_birth_status, component_cfg, scb_risk_cfg, recency_cfg,
    profet_birth_cfg, profet_consistency_cfg, consistency_profile_geos,
    analogue_cfg, analogue_pop, analogue_inflow, analogue_outflow
):
    original_end = b.CALIBRATION_END
    original_windows = b.WINDOWS
    original_migration_windows = b.MIGRATION_WINDOWS
    end_year = origin + HORIZON_YEARS
    try:
        b.CALIBRATION_END = origin
        b.WINDOWS = WINDOWS
        b.MIGRATION_WINDOWS = MIGRATION_WINDOWS

        fertility_rates, fertility_factors = b.fertility_profiles(
            births, fertility_exposure
        )
        mortality_risks, mortality_factors = b.mortality_profiles(
            deaths, birth_year_exposure
        )

        smoothing_diag = b.adaptive_migration_age_smoothing(
            migration_legs, scb_risk_cfg
        )
        analogue_ranking = rolling_analogue_ranking(
            analogue_pop, analogue_inflow, analogue_outflow,
            origin, analogue_cfg
        )
        net_migration_smoothed = smoothed_net_rows_from_diagnostic(
            smoothing_diag, "2580"
        )
        (
            net_migration_analogue_smoothed,
            analogue_smoothing_audit,
        ) = analogue_smoothed_net_rows(
            migration_legs, smoothing_diag, analogue_ranking,
            analogue_cfg, "2580"
        )

        component_inflow, component_out_hazards = b.migration_component_profiles(
            migration_legs, birth_year_exposure
        )
        recency_out_hazards = b.migration_recency_out_hazards(
            migration_legs, birth_year_exposure, recency_cfg
        )
        (
            scb_risk_internal_in_levels,
            scb_risk_internal_in_distribution,
            scb_risk_out,
            scb_risk_international_in,
        ) = b.scb_risk_migration_profiles(
            migration_legs, birth_year_exposure, scb_risk_cfg
        )
        (
            profet_birth_in_levels,
            profet_birth_in_distribution,
            profet_birth_out,
            profet_birth_international_in,
        ) = b.profet_birth_status_profiles(
            migration_birth_status,
            population_birth_status,
            profet_birth_cfg,
            geos=consistency_profile_geos,
        )

        detail_key = cfg["detail_key"]
        births_key = cfg["births_key"]
        detail_file = f"{detail_key}.csv"
        births_file = f"{births_key}.csv"
        forecast_birth_counts = b.load_forecast_birth_counts(births_file)
        forecast_deaths, _ = b.load_forecast_detail(detail_file, detail_key)
        future_fert, future_mort = b.national_future_profiles(
            detail_file,
            detail_key,
            births_file,
        )
        (
            scb_national_immigration,
            scb_national_migration_exposure,
        ) = b.load_forecast_migration_context(
            detail_file,
            detail_key,
        )
        (
            profet_birth_national_immigration,
            profet_birth_national_exposure,
        ) = b.load_forecast_migration_context_by_birth_status(
            detail_file,
            detail_key,
        )
        if not future_fert or not future_mort:
            raise RuntimeError(
                f"Missing usable SCB forecast profiles for origin {origin}"
            )

        profet_consistency_factors = profet_consistency_factor_rows(
            origin,
            end_year,
            consistency_profile_geos,
            population_birth_status,
            profet_birth_in_levels,
            profet_birth_out,
            profet_birth_international_in,
            profet_birth_national_exposure,
            profet_birth_national_immigration,
        )

        fertility_rates, mortality_risks = b.extend_profiles_with_future(
            fertility_rates,
            mortality_risks,
            future_fert,
            future_mort,
            start_year=origin + 1,
        )

        fertility_rates_national_only = national_only_fertility_rows(
            future_fert,
            start_year=origin + 1,
            end_year=end_year,
        )
        mortality_risks_national_only = national_only_mortality_rows(
            future_mort,
            start_year=origin + 1,
            end_year=end_year,
        )

        model = {
            "meta": {
                "schemaVersion": "0.1.0-rolling-backtest",
                "dataReady": True,
                "baseYear": origin,
                "backtestEndYear": end_year,
                "calibrationEndYear": origin,
                "nationalForecastVintage": origin,
                "note": (
                    "Rolling-origin validation: local calibration uses no "
                    f"information after {origin}; future national fertility "
                    f"and mortality use the SCB {origin} forecast vintage."
                ),
            },
            "geographies": [
                {
                    "code": b.FA_CODE,
                    "name": "Luleå FA",
                    "members": list(b.MUNICIPALITIES),
                },
                *[
                    {"code": code, "name": name}
                    for code, name in b.MUNICIPALITIES.items()
                ],
            ],
            "calibration": {
                "defaultYears": 10,
                "options": list(WINDOWS),
            },
            "parameters": {
                "sexRatioMaleAtBirth": 0.515,
                "sexRatioMaleAtBirthSource": "Raps technical specification",
                "qutbMode": "identity",
                "endogenousInMigration": False,
                "endogenousOutMigration": False,
                "migrationComponentStatus": "development_candidate_not_production_default",
                "migrationComponentProductionDefault": False,
                "migrationComponentWindows": component_cfg["legs"],
                "migrationRecencyCandidateStatus": "development_candidate_not_production_default",
                "migrationRecencyCandidate": recency_cfg,
                "scbRiskMigrationStatus": "development_candidate_not_production_default",
                "scbRiskMigrationProductionDefault": False,
                "scbRiskMigrationConfig": scb_risk_cfg,
                "profetBirthStatusStatus": "development_candidate_not_production_default",
                "profetBirthStatusProductionDefault": False,
                "profetBirthStatusConfig": profet_birth_cfg,
                "profetConsistencyStatus": "development_candidate_not_production_default",
                "profetConsistencyProductionDefault": False,
                "profetConsistencyConfig": profet_consistency_cfg,
            },
            "populationBase": base_population(pop, origin),
            "populationBaseBirthStatus": b.birth_status_population_rows(
                population_birth_status, origin
            ),
            "fertilityRates": fertility_rates,
            "fertilityRatesNationalOnly": fertility_rates_national_only,
            "mortalityRisks": mortality_risks,
            "mortalityRisksNationalOnly": mortality_risks_national_only,
            "netMigration": b.migration_profiles(netmig),
            "netMigrationSmoothed": net_migration_smoothed,
            "netMigrationAnalogueSmoothed": net_migration_analogue_smoothed,
            "migrationAgeSmoothingAudit": {
                "origin": origin,
                "analogueTop5": analogue_ranking,
                "analogueRows": analogue_smoothing_audit,
                "localNationalMethod": smoothing_diag.get("method"),
                "profileWindow": smoothing_diag.get("window"),
            },
            "migrationComponentInflow": component_inflow,
            "migrationComponentOutHazards": component_out_hazards,
            "migrationRecencyOutHazards": recency_out_hazards,
            "scbRiskDomesticInLevels": scb_risk_internal_in_levels,
            "scbRiskDomesticInDistribution": scb_risk_internal_in_distribution,
            "scbRiskOutMigration": scb_risk_out,
            "scbRiskInternationalInMigration": scb_risk_international_in,
            "profetBirthStatusDomesticInLevels": profet_birth_in_levels,
            "profetBirthStatusDomesticInDistribution": profet_birth_in_distribution,
            "profetBirthStatusOutMigration": profet_birth_out,
            "profetBirthStatusInternationalInMigration": profet_birth_international_in,
            "profetConsistencyFactors": profet_consistency_factors,
            "profetBirthStatusNationalMeanPopulation": [
                {
                    "year": year,
                    "status": status,
                    "sex": sex,
                    "age": age,
                    "value": value,
                }
                for (year, status, sex, age), value in sorted(
                    profet_birth_national_exposure.items()
                )
                if origin < year <= end_year
            ],
            "profetBirthStatusNationalImmigration": [
                {"year": year, "status": status, "value": value}
                for (year, status), value in sorted(
                    profet_birth_national_immigration.items()
                )
                if origin < year <= end_year
            ],
            "scbRiskNationalMeanPopulation": [
                {"year": year, "sex": sex, "age": age, "value": value}
                for (year, sex, age), value in sorted(
                    scb_national_migration_exposure.items()
                )
                if origin < year <= end_year
            ],
            "scbRiskNationalImmigration": [
                {"year": year, "value": value}
                for year, value in sorted(scb_national_immigration.items())
                if origin < year <= end_year
            ],
            "diagnostics": {
                "relativeFactors": {
                    "fertility": fertility_factors,
                    "mortality": mortality_factors,
                }
            },
        }
        actual = {
            "origin": origin,
            "endYear": end_year,
            "rows": annual_actuals(
                pop, births, deaths, inflow, outflow, netmig, origin, end_year
            ),
            "nationalAssumptionRows": national_assumption_rows_from_counts(
                origin,
                end_year,
                forecast_birth_counts,
                forecast_deaths,
                births,
                deaths,
            ),
        }

        model_path = WORKDIR / f"model_{origin}.json"
        actual_path = WORKDIR / f"actual_{origin}.json"
        model_path.write_text(
            json.dumps(model, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        actual_path.write_text(
            json.dumps(actual, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        return {
            "origin": origin,
            "endYear": end_year,
            "detailKey": detail_key,
            "birthsKey": births_key,
            "modelFile": model_path.name,
            "actualFile": actual_path.name,
        }
    finally:
        b.CALIBRATION_END = original_end
        b.WINDOWS = original_windows
        b.MIGRATION_WINDOWS = original_migration_windows


def main():
    pop = historical_population()
    birth_year_exposure = b.aggregate_fa_age_sex(
        b.load_wide_age_sex(b.HISTORICAL_BIRTH_YEAR_EXPOSURE_FILE)
    )
    fertility_exposure = b.aggregate_fa_age_sex(
        b.load_wide_age_sex(b.HISTORICAL_EVENT_AGE_EXPOSURE_FILE)
    )
    deaths = b.aggregate_fa_age_sex(
        b.load_wide_age_sex("deaths_pre2025.csv")
    )
    births = b.aggregate_fa_births(
        b.load_births("births_pre2025.csv")
    )
    inflow = b.aggregate_fa_age_sex(
        b.load_wide_age_sex("migration_pre2025.csv", b.IN_MIG_CODES)
    )
    outflow = b.aggregate_fa_age_sex(
        b.load_wide_age_sex("migration_pre2025.csv", b.OUT_MIG_CODES)
    )
    netmig = b.aggregate_fa_age_sex(
        b.load_wide_age_sex("migration_pre2025.csv", b.NET_MIG_CODES)
    )
    analogue_cfg = json.loads(
        (ROOT / "data" / "migration_analog_municipalities.json").read_text(
            encoding="utf-8"
        )
    )
    analogue_geos = set((analogue_cfg.get("candidates") or {}).keys())
    analogue_allowed = analogue_geos | {"2580", b.RIKET_CODE}
    analogue_pop = b.load_wide_age_sex(
        "population_pre2025.csv",
        allowed_geos=analogue_allowed,
    )
    analogue_inflow = b.load_wide_age_sex(
        "migration_pre2025.csv",
        b.IN_MIG_CODES,
        allowed_geos=analogue_allowed,
    )
    analogue_outflow = b.load_wide_age_sex(
        "migration_pre2025.csv",
        b.OUT_MIG_CODES,
        allowed_geos=analogue_allowed,
    )
    migration_legs = b.load_migration_legs(
        "migration_birth_region_pre2025.csv",
        b.MIGRATION_LEG_CODES_PRE2025,
        allowed_geos=(
            set(b.MUNICIPALITIES) | analogue_geos | {b.RIKET_CODE}
        ),
    )
    _county, consistency_profile_geos = consistency_support_geographies()
    population_birth_status = b.load_population_birth_status(
        "population_birth_region_pre2025.csv",
        "population_birth_region_pre2025",
        allowed_geos=set(consistency_profile_geos) | {b.RIKET_CODE},
    )
    migration_birth_status = b.load_migration_legs_birth_status(
        "migration_birth_region_pre2025.csv",
        "migration_birth_region_pre2025",
        b.MIGRATION_LEG_CODES_PRE2025,
        allowed_geos=set(consistency_profile_geos) | {b.RIKET_CODE},
    )
    component_cfg = json.loads(
        (ROOT / "data" / "migration_component_windows.json").read_text(encoding="utf-8")
    )
    scb_risk_cfg = json.loads(
        (ROOT / "data" / "scb_risk_migration_config.json").read_text(encoding="utf-8")
    )
    recency_cfg = json.loads(
        (ROOT / "data" / "migration_recency_candidate.json").read_text(encoding="utf-8")
    )
    if recency_cfg.get("status") != "development_candidate_locked_before_full_cohort_results":
        raise RuntimeError("Unexpected migration recency candidate status.")
    profet_birth_cfg = json.loads(
        (ROOT / "data" / "profet_birth_status_config.json").read_text(encoding="utf-8")
    )
    if profet_birth_cfg.get("status") != "development_candidate_locked_before_birth_status_results":
        raise RuntimeError("Unexpected Profet birth-status candidate status.")
    profet_consistency_cfg = json.loads(
        CONSISTENCY_ADJUSTMENT_CONFIG.read_text(encoding="utf-8")
    )
    if profet_consistency_cfg.get("status") != "development_candidate_locked_before_adjustment_results":
        raise RuntimeError("Unexpected consistency adjustment candidate status.")

    entries = [
        build_origin(
            origin, cfg, pop, birth_year_exposure, fertility_exposure,
            deaths, births, inflow, outflow, netmig, migration_legs,
            population_birth_status, migration_birth_status,
            component_cfg, scb_risk_cfg, recency_cfg, profet_birth_cfg,
            profet_consistency_cfg, consistency_profile_geos,
            analogue_cfg, analogue_pop, analogue_inflow, analogue_outflow
        )
        for origin, cfg in ORIGINS.items()
    ]

    manifest = {
        "schemaVersion": "0.1.0",
        "method": (
            "Vintage-correct rolling-origin validation with three-year "
            "forecast horizons."
        ),
        "origins": entries,
        "windows": list(WINDOWS),
        "migrationWindows": list(MIGRATION_WINDOWS),
        "componentFlowCandidate": {
            "config": "data/migration_component_windows.json",
            "selectionSample": "Lulea municipality component results used to choose windows after #37",
            "independentHoldout": False,
            "note": "This rolling comparison is a development diagnostic, not independent confirmation."
        },
        "migrationRecencyCandidate": {
            "config": "data/migration_recency_candidate.json",
            "baseEngine": "component_flow",
            "adaptiveLeg": "rest_sweden",
            "adaptiveDirection": "out",
            "independentHoldout": False,
            "note": "Selected from Lulea migration diagnostics after #53; full cohort rolling-origin is stage 1."
        },
        "scbRiskFlowCandidate": {
            "config": "data/scb_risk_migration_config.json",
            "methodBasis": "Published SCB regional projection method; locked before this candidate is evaluated.",
            "independentHoldout": False,
            "note": "Lulea rolling-origin results are development diagnostics. Previously viewed municipalities are not independent confirmation."
        },
        "migrationAgeSmoothingCandidate": {
            "config": "data/scb_risk_migration_config.json",
            "analogueConfig": "data/migration_analog_municipalities.json",
            "existingGate": scb_risk_cfg["ageProfileSmoothing"]["evaluation"],
            "analogueGate": analogue_cfg["smoothingCandidate"]["evaluation"],
            "backtestSelection": analogue_cfg["smoothingCandidate"]["backtestSelection"],
            "structuralTarget": analogue_cfg["smoothingCandidate"]["structuralTarget"],
            "independentHoldout": False,
            "note": "Analogue top-five is re-ranked at each origin using only information available through that origin."
        },
        "profetBirthStatusCandidate": {
            "config": "data/profet_birth_status_config.json",
            "methodBasis": "Published SCB regional state dimension: single-year age x sex x Swedish-/foreign-born.",
            "independentHoldout": False,
            "promotionGate": profet_birth_cfg["evaluation"]["promotionToLevel3"],
            "note": "This stage isolates birth-status migration/state effects; fertility and mortality are unchanged."
        },
        "profetConsistencyCandidate": {
            "config": "data/scb_consistency_adjustment_config.json",
            "developmentOrigins": profet_consistency_cfg["accuracyEvaluation"]["developmentOrigins"],
            "promotionGate": profet_consistency_cfg["accuracyEvaluation"],
            "independentHoldout": False,
            "note": "Uses frozen same-vintage SCB county flow targets and all 14 Norrbotten municipalities. Production net10 remains unchanged."
        },
        "horizonYears": HORIZON_YEARS,
        "overlapNote": (
            "Forecast windows overlap in calendar time and must not be treated "
            "as statistically independent experiments."
        ),
    }
    (WORKDIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "Built rolling-origin inputs for: "
        + ", ".join(str(x["origin"]) for x in entries)
    )


if __name__ == "__main__":
    main()
