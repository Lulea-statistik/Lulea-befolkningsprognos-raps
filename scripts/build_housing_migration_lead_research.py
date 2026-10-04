#!/usr/bin/env python3
"""Research-only diagnostic: lagged housing-stock change vs net migration.

This script does not alter the demographic forecast. It tests whether the
previous year's observed dwelling-stock change adds one-year-ahead predictive
information about total net migration beyond a trailing 10-year baseline.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import build_model_data as b

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CONFIG = ROOT / "data" / "housing_migration_lead_research.json"
OUT = ROOT / "data" / "backtests" / "housing_migration_lead_research.json"

TARGET_YEARS = (2019, 2020, 2021, 2022, 2023, 2024)
MIN_TRAINING = 4
EXTERNAL_FA = {
    "FA16_TRH": ("1427","1430","1439","1444","1461","1484","1485","1487","1488"),
    "FA36_GAV": ("2101","2104","2180","2181","0319"),
    "FA42_SUN": ("2260","2262","2280","2281"),
}
EXTERNAL_ANCHORS = ("1488","2180","2281")


def write(payload):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def load_housing():
    path = RAW / "housing_stock.csv"
    info = (b.manifest().get("files") or {}).get("housing_stock")
    if not path.exists() or not info:
        return None, {"status":"source_missing","note":"housing_stock.csv missing"}

    stock = defaultdict(float)
    for row in b.rows(path):
        geo = str(row.get("Region", "")).strip()
        if not geo:
            continue
        for col, _, year in b.value_columns(row.keys()):
            if 2013 <= year <= 2025:
                stock[(geo, year)] += b.num(row[col])
    return stock, {
        "status":"loaded",
        "regions":sorted({g for g, _ in stock}),
        "years":sorted({y for _, y in stock}),
    }


def load_net_migration():
    path = RAW / "migration_pre2025.csv"
    info = (b.manifest().get("files") or {}).get("migration_pre2025")
    if not path.exists() or not info:
        return None, {"status":"source_missing","note":"migration_pre2025.csv missing"}

    net = defaultdict(float)
    for row in b.rows(path):
        geo = str(row.get("Region", "")).strip()
        sex = b.SEX_MAP.get(str(row.get("Kon", "")).strip())
        age = b.age_value(row.get("Alder", ""))
        if not geo or not sex or age is None:
            continue
        for col, code, year in b.value_columns(row.keys(), b.NET_MIG_CODES):
            net[(geo, year)] += b.num(row[col])
    return net, {
        "status":"loaded",
        "regions":sorted({g for g, _ in net}),
        "years":sorted({y for _, y in net}),
    }


def aggregate_geo(data, code, members, years):
    for year in years:
        data[(code, year)] = sum(data.get((g, year), 0.0) for g in members)


def trailing_mean(net, geo, target, window=10):
    vals = [net.get((geo, y)) for y in range(target-window, target)]
    vals = [v for v in vals if v is not None]
    if len(vals) < window:
        return None
    return sum(vals) / len(vals)


def housing_delta(stock, geo, year):
    a = stock.get((geo, year))
    z = stock.get((geo, year-1))
    if a is None or z is None:
        return None
    return a - z


def training_pairs(stock, net, geo, target):
    pairs = []
    # Earliest usable target is 2015 because predictor uses stock change 2014-2013.
    for y in range(2015, target):
        x = housing_delta(stock, geo, y-1)
        base = trailing_mean(net, geo, y, 10)
        actual = net.get((geo, y))
        if x is None or base is None or actual is None:
            continue
        pairs.append((x, actual-base, y))
    return pairs


def fit_beta(pairs):
    if len(pairs) < MIN_TRAINING:
        return None
    mean_x = sum(x for x, _, _ in pairs) / len(pairs)
    centered = [(x-mean_x, resid) for x, resid, _ in pairs]
    denom = sum(x*x for x, _ in centered)
    if denom <= 0:
        return 0.0, mean_x
    beta = sum(x*y for x, y in centered) / denom
    return beta, mean_x


def predict_one(stock, net, geo, target):
    pairs = training_pairs(stock, net, geo, target)
    fit = fit_beta(pairs)
    baseline = trailing_mean(net, geo, target, 10)
    actual = net.get((geo, target))
    x = housing_delta(stock, geo, target-1)
    if fit is None or baseline is None or actual is None or x is None:
        return None
    beta, mean_x = fit
    candidate = baseline + beta * (x - mean_x)
    return {
        "targetYear":target,
        "trainingPairs":len(pairs),
        "beta":beta,
        "latestLaggedHousingDelta":x,
        "trainingMeanLaggedHousingDelta":mean_x,
        "actualNetMigration":actual,
        "baselinePrediction":baseline,
        "candidatePrediction":candidate,
        "baselineError":baseline-actual,
        "candidateError":candidate-actual,
    }


def mae(rows, key):
    vals = [abs(r[key]) for r in rows if r is not None]
    return sum(vals)/len(vals) if vals else None


def evaluate_geo(stock, net, geo):
    rows = [predict_one(stock, net, geo, y) for y in TARGET_YEARS]
    rows = [r for r in rows if r is not None]
    signs = [1 if r["beta"] > 0 else -1 if r["beta"] < 0 else 0 for r in rows]
    pos = sum(s > 0 for s in signs)
    neg = sum(s < 0 for s in signs)
    dominant = "positive" if pos >= neg else "negative"
    same_sign_count = max(pos, neg)
    return {
        "observations":len(rows),
        "candidateMAE":mae(rows,"candidateError"),
        "baselineMAE":mae(rows,"baselineError"),
        "dominantBetaSign":dominant,
        "sameSignCount":same_sign_count,
        "rows":rows,
    }


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    stock, hsrc = load_housing()
    net, msrc = load_net_migration()
    if stock is None or net is None:
        write({
            "schemaVersion":"0.1.0",
            "candidate":cfg,
            "status":"source_missing",
            "housingSource":hsrc,
            "migrationSource":msrc,
        })
        return

    years = range(1997, 2026)
    aggregate_geo(stock, b.FA_CODE, tuple(b.MUNICIPALITIES), range(2013, 2026))
    aggregate_geo(net, b.FA_CODE, tuple(b.MUNICIPALITIES), years)
    for code, members in EXTERNAL_FA.items():
        aggregate_geo(stock, code, members, range(2013, 2026))
        aggregate_geo(net, code, members, years)

    result = {
        "schemaVersion":"0.1.0",
        "candidate":cfg,
        "status":"development_scored",
        "housingSource":hsrc,
        "migrationSource":msrc,
        "development":{},
        "external":{},
    }

    for geo in ("2580", b.FA_CODE):
        result["development"][geo] = evaluate_geo(stock, net, geo)

    external_available = all(
        any((g, y) in stock for y in range(2013, 2026))
        for g in EXTERNAL_ANCHORS
    )
    if external_available:
        result["external"]["regions"] = {
            geo:evaluate_geo(stock, net, geo) for geo in EXTERNAL_FA
        }
        result["external"]["anchors"] = {
            geo:evaluate_geo(stock, net, geo) for geo in EXTERNAL_ANCHORS
        }
    else:
        result["external"] = {
            "status":"awaiting_full_refresh_with_reference_housing_geographies"
        }

    dev_checks = {}
    for geo in ("2580", b.FA_CODE):
        s = result["development"][geo]
        dev_checks[geo] = {
            "maeStrictlyBetter":(
                s["candidateMAE"] is not None and s["baselineMAE"] is not None
                and s["candidateMAE"] < s["baselineMAE"]
            ),
            "betaSignStable":s["sameSignCount"] >= 5,
        }
    result["developmentGate"] = {
        "status":"development_only",
        "checks":dev_checks,
        "passed":all(
            x["maeStrictlyBetter"] and x["betaSignStable"]
            for x in dev_checks.values()
        )
    }

    if external_available:
        region_checks = {}
        cand = []
        base = []
        for geo, s in result["external"]["regions"].items():
            region_checks[geo] = {
                "nonWorse":(
                    s["candidateMAE"] is not None and s["baselineMAE"] is not None
                    and s["candidateMAE"] <= s["baselineMAE"]
                )
            }
            if s["candidateMAE"] is not None:
                cand.append(s["candidateMAE"])
                base.append(s["baselineMAE"])
        pooled_c = sum(cand)/len(cand) if cand else None
        pooled_b = sum(base)/len(base) if base else None
        result["externalGate"] = {
            "status":"predeclared_external_gate",
            "checks":region_checks,
            "pooledCandidateMAE":pooled_c,
            "pooledBaselineMAE":pooled_b,
            "pooledStrictlyBetter":(
                pooled_c is not None and pooled_b is not None and pooled_c < pooled_b
            ),
            "passed":(
                all(x["nonWorse"] for x in region_checks.values())
                and pooled_c is not None and pooled_c < pooled_b
            )
        }

    write(result)
    print(
        "housing-migration research: "
        f"Lulea {result['development']['2580']['candidateMAE']} vs "
        f"{result['development']['2580']['baselineMAE']}; "
        f"FA {result['development'][b.FA_CODE]['candidateMAE']} vs "
        f"{result['development'][b.FA_CODE]['baselineMAE']}; "
        f"development gate={result['developmentGate']['passed']}"
    )


if __name__ == "__main__":
    main()
