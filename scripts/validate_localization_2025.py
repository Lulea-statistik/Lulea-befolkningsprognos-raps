#!/usr/bin/env python3
"""Independent 2025 component holdout for localization candidates.

Calibration and candidate definitions use data through 2024 only.
The 2025 observations/exposures are used only for scoring.
"""
from __future__ import annotations

import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

import build_model_data as b

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "model_data.json"
OUT_JSON = ROOT / "data" / "backtests" / "localization_2025_holdout.json"
OUT_JS = ROOT / "data" / "backtests" / "localization_2025_holdout.js"
WINDOW = 10
LAMBDA = 10.0
GEOS = ("2580", b.FA_CODE)


def clamp_ratio(value, lo=b.RATIO_MIN, hi=b.RATIO_MAX):
    return max(lo, min(hi, float(value)))


def mean(values):
    vals = [float(v) for v in values]
    return statistics.fmean(vals) if vals else 0.0


def sample_variance(values):
    vals = [float(v) for v in values]
    return statistics.variance(vals) if len(vals) >= 2 else 0.0


def solve_dense(A, y):
    n = len(A)
    M = [list(A[i]) + [float(y[i])] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(M[r][col]))
        if abs(M[pivot][col]) < 1e-12:
            continue
        M[col], M[pivot] = M[pivot], M[col]
        div = M[col][col]
        for j in range(col, n + 1):
            M[col][j] /= div
        for r in range(n):
            if r == col:
                continue
            mult = M[r][col]
            if not mult:
                continue
            for j in range(col, n + 1):
                M[r][j] -= mult * M[col][j]
    return [row[n] if math.isfinite(row[n]) else 0.0 for row in M]


def smoothing_spline_factors(rows, lam=LAMBDA):
    groups = defaultdict(list)
    for row in rows:
        groups[(row["geo"], int(row["window"]))].append(row)
    out = {}
    for key, group in groups.items():
        group = sorted(group, key=lambda r: int(r["age"]))
        n = len(group)
        if n < 3:
            for r in group:
                out[(r["geo"], int(r["age"]))] = clamp_ratio(r["rawCellFactor"])
            continue
        x = [int(r["age"]) for r in group]
        h = [x[i + 1] - x[i] for i in range(n - 1)]
        m = n - 2
        Q = [[0.0] * m for _ in range(n)]
        R = [[0.0] * m for _ in range(m)]
        for j in range(m):
            h0, h1 = h[j], h[j + 1]
            Q[j][j] = 1.0 / h0
            Q[j + 1][j] = -(1.0 / h0 + 1.0 / h1)
            Q[j + 2][j] = 1.0 / h1
            R[j][j] = (h0 + h1) / 3.0
            if j < m - 1:
                R[j][j + 1] = h1 / 6.0
                R[j + 1][j] = h1 / 6.0

        X = [[0.0] * n for _ in range(m)]
        for col in range(n):
            sol = solve_dense(R, [Q[col][j] for j in range(m)])
            for j in range(m):
                X[j][col] = sol[j]

        K = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                K[i][j] = sum(Q[i][k] * X[k][j] for k in range(m))

        y = []
        event_weights = []
        for r in group:
            g = clamp_ratio(r["municipalityFactor"])
            l = clamp_ratio(r["rawCellFactor"])
            y.append(math.log(max(1e-9, l / g)))
            event_weights.append(max(0.5, float(r.get("cellExpectedEvents") or 0.5)))
        med = statistics.median(event_weights) if event_weights else 1.0
        weights = [max(0.05, v / med) for v in event_weights]

        A = [[0.0] * n for _ in range(n)]
        rhs = [0.0] * n
        for i in range(n):
            A[i][i] += weights[i]
            rhs[i] = weights[i] * y[i]
            for j in range(n):
                A[i][j] += lam * K[i][j]
        z = solve_dense(A, rhs)

        for i, r in enumerate(group):
            g = clamp_ratio(r["municipalityFactor"])
            factor = clamp_ratio(g * math.exp(z[i]))
            out[(r["geo"], int(r["age"]))] = factor
    return out


def empirical_bayes_factors(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[(row["geo"], int(row["window"]), row["sex"])].append(row)
    out = {}
    for group in groups.values():
        stats = []
        for r in group:
            g = clamp_ratio(r["municipalityFactor"])
            l = clamp_ratio(r["rawCellFactor"])
            delta = math.log(max(1e-9, l / g))
            expected = max(0.0, float(r.get("cellExpectedEvents") or 0.0))
            raw = max(0.0, float(r.get("rawCellFactor") or 0.0))
            observed_approx = expected * raw
            sampling_var = 1.0 / max(0.5, observed_approx + 0.5)
            stats.append((r, g, delta, sampling_var))
        observed_var = sample_variance([x[2] for x in stats])
        mean_sampling = mean([x[3] for x in stats])
        tau2 = max(0.0, observed_var - mean_sampling)
        for r, g, delta, sampling_var in stats:
            w = 0.0 if tau2 <= 0 else tau2 / (tau2 + sampling_var)
            factor = clamp_ratio(g * math.exp(w * delta))
            out[(r["geo"], r["sex"], int(r["age"]))] = factor
    return out


def current_factor(row):
    g = float(row.get("municipalityFactor") or 1.0)
    raw = clamp_ratio(row.get("rawCellFactor") or g)
    w = max(0.0, min(1.0, float(row.get("cellLocalWeight") or 0.0)))
    return (1.0 - w) * g + w * raw


def score_fertility(model):
    rows = [
        r for r in model.get("fertilityRates", [])
        if r.get("year") is None and int(r["window"]) == WINDOW and r["geo"] != "SE"
    ]
    spline = smoothing_spline_factors(rows, LAMBDA)
    births25 = b.aggregate_fa_births(b.load_births("births_2025.csv"))
    exp25 = b.aggregate_fa_age_sex(
        b.load_wide_age_sex("mean_population_event_age_2025.csv")
    )
    # Hold the pre-2025 national age profile fixed for both methods.
    # This isolates the localization choice; 2025 is used only as local exposure/outcome.
    base = {(r["geo"], int(r["age"])): r for r in rows}
    out = {}
    for geo in GEOS:
        cells = []
        for age in range(15, 50):
            r = base[(geo, age)]
            nr = max(0.0, float(r.get("nationalRate") or 0.0))
            exposure = exp25.get((geo, 2025, "K", age), 0.0)
            actual = births25.get((geo, 2025, age), 0.0)
            current = exposure * nr * current_factor(r)
            candidate = exposure * nr * spline[(geo, age)]
            cells.append({
                "age": age,
                "actual": actual,
                "current": current,
                "candidate": candidate,
            })
        actual_total = sum(x["actual"] for x in cells)
        current_total = sum(x["current"] for x in cells)
        candidate_total = sum(x["candidate"] for x in cells)
        out[geo] = {
            "cells": cells,
            "actualTotal": actual_total,
            "currentTotal": current_total,
            "candidateTotal": candidate_total,
            "currentTotalAbsError": abs(current_total - actual_total),
            "candidateTotalAbsError": abs(candidate_total - actual_total),
            "currentCellMAE": mean(abs(x["current"] - x["actual"]) for x in cells),
            "candidateCellMAE": mean(abs(x["candidate"] - x["actual"]) for x in cells),
        }
    return out


def score_mortality(model):
    rows = [
        r for r in model.get("mortalityRisks", [])
        if r.get("year") is None and int(r["window"]) == WINDOW and r["geo"] != "SE"
    ]
    eb = empirical_bayes_factors(rows)
    deaths25 = b.aggregate_fa_age_sex(b.load_wide_age_sex("deaths_2025.csv"))
    exp25 = b.aggregate_fa_age_sex(
        b.load_wide_age_sex("mean_population_2025.csv")
    )
    base = {(r["geo"], r["sex"], int(r["age"])): r for r in rows}
    out = {}
    for geo in GEOS:
        cells = []
        for sex in ("K", "M"):
            for age in range(101):
                r = base[(geo, sex, age)]
                nh = max(0.0, float(r.get("nationalHazard") or 0.0))
                exposure = exp25.get((geo, 2025, sex, age), 0.0)
                actual = deaths25.get((geo, 2025, sex, age), 0.0)
                current = exposure * nh * current_factor(r)
                candidate = exposure * nh * eb[(geo, sex, age)]
                cells.append({
                    "sex": sex,
                    "age": age,
                    "actual": actual,
                    "current": current,
                    "candidate": candidate,
                })
        actual_total = sum(x["actual"] for x in cells)
        current_total = sum(x["current"] for x in cells)
        candidate_total = sum(x["candidate"] for x in cells)
        out[geo] = {
            "cells": cells,
            "actualTotal": actual_total,
            "currentTotal": current_total,
            "candidateTotal": candidate_total,
            "currentTotalAbsError": abs(current_total - actual_total),
            "candidateTotalAbsError": abs(candidate_total - actual_total),
            "currentCellMAE": mean(abs(x["current"] - x["actual"]) for x in cells),
            "candidateCellMAE": mean(abs(x["candidate"] - x["actual"]) for x in cells),
        }
    return out


def gate(result):
    checks = {}
    for geo in GEOS:
        r = result[geo]
        checks[geo] = {
            "cellMAEImproves": r["candidateCellMAE"] < r["currentCellMAE"],
            "totalAbsErrorNotWorse": r["candidateTotalAbsError"] <= r["currentTotalAbsError"],
        }
    return {
        "checks": checks,
        "passed": all(v for g in checks.values() for v in g.values()),
    }


def compact(d):
    return {
        geo: {
            k: round(v, 3) if isinstance(v, (int, float)) else v
            for k, v in row.items() if k != "cells"
        }
        for geo, row in d.items()
    }


def main():
    model = json.loads(MODEL.read_text(encoding="utf-8"))
    fertility = score_fertility(model)
    mortality = score_mortality(model)
    report = {
        "schemaVersion": "0.1.0",
        "status": "independent_2025_component_holdout",
        "independentHoldout": True,
        "calibrationThrough": 2024,
        "holdoutYear": 2025,
        "productionWindow": WINDOW,
        "methodBreakNote": (
            "2025 is kept outside calibration. This component-rate holdout uses observed 2025 local "
            "event exposures/outcomes while holding the pre-2025 national age profile fixed for "
            "both comparators. It therefore isolates the local shape/localization choice rather "
            "than the full CKM population bridge or national 2025 level shifts."
        ),
        "predeclaredGate": {
            "fertility": (
                "Cubic smoothing spline lambda=10 must reduce maternal-age cell MAE and must not "
                "worsen total-birth absolute error for both Lulea and Lulea FA."
            ),
            "mortality": (
                "Method-of-moments empirical Bayes must reduce age-sex cell MAE and must not "
                "worsen total-death absolute error for both Lulea and Lulea FA."
            ),
        },
        "fertility": {
            "candidate": "natural cubic smoothing spline",
            "lambda": LAMBDA,
            "summary": compact(fertility),
            "gate": gate(fertility),
        },
        "mortality": {
            "candidate": "method-of-moments empirical Bayes",
            "summary": compact(mortality),
            "gate": gate(mortality),
        },
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUT_JS.write_text(
        "window.LOCALIZATION_2025_HOLDOUT = "
        + json.dumps(report, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "fertility": report["fertility"]["summary"],
        "fertilityGate": report["fertility"]["gate"],
        "mortality": report["mortality"]["summary"],
        "mortalityGate": report["mortality"]["gate"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
