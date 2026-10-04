#!/usr/bin/env python3
"""Locked development diagnostic for non-neutral qutb education transitions.

The candidate is deliberately separate from the demographic production engine.
It forecasts education shares within sex x one-year-age cohorts and compares
them with the production placeholder qutb=identity.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import build_model_data as b

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
CONFIG = ROOT / "data" / "qutb_education_transition_candidate.json"
OUT = ROOT / "data" / "backtests" / "qutb_education_transition.json"

LEVELS = (
    "pre_secondary",
    "upper_secondary",
    "postsecondary_short",
    "postsecondary_long",
    "postgraduate",
)
ORIGINS = (2018, 2019, 2020, 2021)
HORIZONS = (1, 2, 3)
SCORED_AGES = range(20, 65)
WINDOW = 10
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


def norm_text(value):
    return str(value or "").strip().lower()


def education_group(label):
    x = norm_text(label)
    if "uppgift saknas" in x or "okänd" in x or "okand" in x:
        return None
    if "forskar" in x:
        return "postgraduate"
    if "eftergymnasial" in x:
        if (
            "kortare än 3" in x
            or "kortare an 3" in x
            or "mindre än 3" in x
            or "mindre an 3" in x
        ):
            return "postsecondary_short"
        return "postsecondary_long"
    if "gymnasial" in x and "förgymnasial" not in x and "forgymnasial" not in x:
        return "upper_secondary"
    if "förgymnasial" in x or "forgymnasial" in x:
        return "pre_secondary"
    return None


def dim_id(info, needle, fallback=None):
    labels = info.get("dimension_labels") or {}
    needle = needle.lower()
    for key, label in labels.items():
        if needle in norm_text(label):
            return key
    if fallback and fallback in (info.get("dimension_value_labels") or {}):
        return fallback
    return fallback


def load_stock():
    path = RAW / "education_population.csv"
    manifest = b.manifest()
    info = (manifest.get("files") or {}).get("education_population")
    if not path.exists() or not info:
        return None, {
            "status": "source_missing",
            "note": "education_population.csv requires a full SCB refresh."
        }

    region_dim = dim_id(info, "region", "Region")
    age_dim = dim_id(info, "ålder", "Alder")
    sex_dim = dim_id(info, "kön", "Kon")
    edu_dim = dim_id(info, "utbildningsnivå")
    if not edu_dim:
        return None, {
            "status": "source_invalid",
            "note": "Could not identify education-level dimension from raw manifest."
        }

    edu_labels = (
        (info.get("dimension_value_labels") or {}).get(edu_dim) or {}
    )
    code_to_level = {
        str(code): education_group(label)
        for code, label in edu_labels.items()
    }
    recognized = {
        str(code): group
        for code, group in code_to_level.items()
        if group is not None
    }
    if not recognized:
        return None, {
            "status": "source_invalid",
            "note": "No supported education levels found in source metadata.",
            "educationLabels": edu_labels,
        }

    stock = defaultdict(float)
    for row in b.rows(path):
        geo = str(row.get(region_dim, "")).strip()
        sex = b.SEX_MAP.get(str(row.get(sex_dim, "")).strip())
        age = b.age_value(row.get(age_dim, ""))
        level = recognized.get(str(row.get(edu_dim, "")).strip())
        if not geo or not sex or age is None or not (16 <= age <= 74) or not level:
            continue
        for col, _, year in b.value_columns(row.keys()):
            if 2008 <= year <= 2025:
                stock[(geo, year, sex, age, level)] += b.num(row[col])

    return stock, {
        "status": "loaded",
        "regionDimension": region_dim,
        "ageDimension": age_dim,
        "sexDimension": sex_dim,
        "educationDimension": edu_dim,
        "recognizedEducationCodes": recognized,
        "educationLabels": edu_labels,
    }


def aggregate_fa(stock):
    out = defaultdict(float, stock)
    for year in range(2008, 2026):
        for sex in ("K", "M"):
            for age in range(16, 75):
                for level in LEVELS:
                    out[(b.FA_CODE, year, sex, age, level)] = sum(
                        stock.get((geo, year, sex, age, level), 0.0)
                        for geo in b.MUNICIPALITIES
                    )
    return out


def aggregate_external_fa(stock):
    out = defaultdict(float, stock)
    for code, members in EXTERNAL_FA.items():
        for year in range(2008, 2026):
            for sex in ("K", "M"):
                for age in range(16, 75):
                    for level in LEVELS:
                        out[(code, year, sex, age, level)] = sum(
                            stock.get((geo, year, sex, age, level), 0.0)
                            for geo in members
                        )
    return out


def shares(stock, geo, year, sex, age):
    vals = [stock.get((geo, year, sex, age, level), 0.0) for level in LEVELS]
    total = sum(vals)
    if total <= 0:
        return None
    return [v / total for v in vals]


def transition_probabilities(stock, origin):
    """Estimate adjacent upward probabilities from national cohort shares."""
    probs = {}
    for sex in ("K", "M"):
        for age in range(16, 74):
            numer = [0.0] * (len(LEVELS) - 1)
            denom = [0.0] * (len(LEVELS) - 1)
            for year in range(origin - WINDOW, origin):
                before = shares(stock, b.RIKET_CODE, year, sex, age)
                after = shares(stock, b.RIKET_CODE, year + 1, sex, age + 1)
                if before is None or after is None:
                    continue
                total_before = sum(
                    stock.get((b.RIKET_CODE, year, sex, age, level), 0.0)
                    for level in LEVELS
                )
                if total_before <= 0:
                    continue
                for j in range(len(LEVELS) - 1):
                    before_high = sum(before[j + 1:])
                    after_high = sum(after[j + 1:])
                    gain = max(0.0, after_high - before_high)
                    base_share = before[j]
                    # Event-weight the inferred probability by the number
                    # currently exposed in the lower education state.
                    exposed = total_before * base_share
                    if exposed <= 0:
                        continue
                    inferred = min(1.0, gain / max(base_share, 1e-12))
                    numer[j] += inferred * exposed
                    denom[j] += exposed
            probs[(sex, age)] = [
                0.0 if denom[j] <= 0 else min(1.0, max(0.0, numer[j] / denom[j]))
                for j in range(len(LEVELS) - 1)
            ]
    return probs


def advance(dist, probs):
    out = list(dist)
    moves = [probs[j] * dist[j] for j in range(len(LEVELS) - 1)]
    for j, move in enumerate(moves):
        out[j] -= move
        out[j + 1] += move
    total = sum(out)
    if total <= 0:
        return None
    return [max(0.0, x) / total for x in out]


def forecast_distribution(stock, geo, origin, sex, base_age, horizon, probs, identity=False):
    dist = shares(stock, geo, origin, sex, base_age)
    if dist is None:
        return None
    age = base_age
    for _ in range(horizon):
        if not identity:
            dist = advance(dist, probs.get((sex, age), [0.0] * 4))
            if dist is None:
                return None
        age += 1
    return dist


def mae(values):
    return sum(values) / len(values) if values else None


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    stock, source = load_stock()
    if stock is None:
        write({
            "schemaVersion": "0.1.0",
            "candidate": cfg,
            "source": source,
            "status": source["status"],
            "maturityEvidence": "awaiting_full_refresh",
        })
        print(source["note"])
        return

    stock = aggregate_fa(stock)
    result = {
        "schemaVersion": "0.1.0",
        "candidate": cfg,
        "source": source,
        "status": "development_scored",
        "origins": {},
        "summary": {},
        "structural": {},
    }

    transition_min = 1.0
    transition_max = 0.0
    share_sum_max_error = 0.0

    for origin in ORIGINS:
        probs = transition_probabilities(stock, origin)
        flat = [p for arr in probs.values() for p in arr]
        if flat:
            transition_min = min(transition_min, min(flat))
            transition_max = max(transition_max, max(flat))

        origin_out = {}
        for geo in ("2580", b.FA_CODE):
            geo_out = {}
            for horizon in HORIZONS:
                cand_err = []
                ident_err = []
                observations = 0
                for sex in ("K", "M"):
                    for target_age in SCORED_AGES:
                        base_age = target_age - horizon
                        if base_age < 16:
                            continue
                        actual = shares(
                            stock, geo, origin + horizon, sex, target_age
                        )
                        cand = forecast_distribution(
                            stock, geo, origin, sex, base_age,
                            horizon, probs, identity=False
                        )
                        ident = forecast_distribution(
                            stock, geo, origin, sex, base_age,
                            horizon, probs, identity=True
                        )
                        if actual is None or cand is None or ident is None:
                            continue
                        share_sum_max_error = max(
                            share_sum_max_error,
                            abs(sum(cand) - 1.0),
                            abs(sum(ident) - 1.0),
                        )
                        cand_err.extend(
                            abs(cand[i] - actual[i]) for i in range(len(LEVELS))
                        )
                        ident_err.extend(
                            abs(ident[i] - actual[i]) for i in range(len(LEVELS))
                        )
                        observations += 1
                geo_out[str(horizon)] = {
                    "observationsSexAgeCells": observations,
                    "candidateShareMAE": mae(cand_err),
                    "identityShareMAE": mae(ident_err),
                }
            origin_out[geo] = geo_out
        result["origins"][str(origin)] = origin_out

    for geo in ("2580", b.FA_CODE):
        result["summary"][geo] = {}
        for horizon in HORIZONS:
            cand = []
            ident = []
            cells = 0
            for origin in ORIGINS:
                x = result["origins"][str(origin)][geo][str(horizon)]
                if x["candidateShareMAE"] is not None:
                    cand.append(x["candidateShareMAE"])
                    ident.append(x["identityShareMAE"])
                    cells += x["observationsSexAgeCells"]
            result["summary"][geo][str(horizon)] = {
                "originCount": len(cand),
                "observationsSexAgeCells": cells,
                "candidateShareMAE": mae(cand),
                "identityShareMAE": mae(ident),
            }

    stock = aggregate_external_fa(stock)
    external = {"regions": {}, "anchors": {}, "pooled": {}}
    for geo in tuple(EXTERNAL_FA) + EXTERNAL_ANCHORS:
        geo_out = {}
        for horizon in HORIZONS:
            cand = []
            ident = []
            cells = 0
            for origin in ORIGINS:
                probs = transition_probabilities(stock, origin)
                for sex in ("K", "M"):
                    for target_age in SCORED_AGES:
                        base_age = target_age - horizon
                        if base_age < 16:
                            continue
                        actual = shares(stock, geo, origin + horizon, sex, target_age)
                        candidate = forecast_distribution(
                            stock, geo, origin, sex, base_age,
                            horizon, probs, identity=False
                        )
                        identity = forecast_distribution(
                            stock, geo, origin, sex, base_age,
                            horizon, probs, identity=True
                        )
                        if actual is None or candidate is None or identity is None:
                            continue
                        cand.extend(
                            abs(candidate[i] - actual[i]) for i in range(len(LEVELS))
                        )
                        ident.extend(
                            abs(identity[i] - actual[i]) for i in range(len(LEVELS))
                        )
                        cells += 1
            geo_out[str(horizon)] = {
                "observationsSexAgeCells": cells,
                "candidateShareMAE": mae(cand),
                "identityShareMAE": mae(ident),
            }
        target = external["regions"] if geo in EXTERNAL_FA else external["anchors"]
        target[geo] = geo_out

    pooled_cand = []
    pooled_ident = []
    for geo in EXTERNAL_FA:
        for horizon in (1, 2):
            x = external["regions"][geo][str(horizon)]
            if x["candidateShareMAE"] is not None:
                pooled_cand.append(x["candidateShareMAE"])
                pooled_ident.append(x["identityShareMAE"])
    external["pooled"] = {
        "candidateShareMAE": mae(pooled_cand),
        "identityShareMAE": mae(pooled_ident),
    }

    external_checks = []
    for geo in EXTERNAL_FA:
        n1 = external["regions"][geo]["1"]
        n2 = external["regions"][geo]["2"]
        external_checks.append({
            "geo": geo,
            "n1StrictlyBetter": (
                n1["candidateShareMAE"] is not None
                and n1["candidateShareMAE"] < n1["identityShareMAE"]
            ),
            "n2NonWorse": (
                n2["candidateShareMAE"] is not None
                and n2["candidateShareMAE"] <= n2["identityShareMAE"]
            ),
        })
    anchor_checks = []
    for geo in EXTERNAL_ANCHORS:
        n1 = external["anchors"][geo]["1"]
        anchor_checks.append({
            "geo": geo,
            "n1StrictlyBetter": (
                n1["candidateShareMAE"] is not None
                and n1["candidateShareMAE"] < n1["identityShareMAE"]
            ),
        })
    external_passed = (
        all(x["n1StrictlyBetter"] and x["n2NonWorse"] for x in external_checks)
        and all(x["n1StrictlyBetter"] for x in anchor_checks)
        and external["pooled"]["candidateShareMAE"] is not None
        and external["pooled"]["candidateShareMAE"] < external["pooled"]["identityShareMAE"]
    )
    external["gate"] = {
        "status": "predeclared_external_level3_gate",
        "checks": external_checks,
        "anchorChecks": anchor_checks,
        "pooledStrictlyBetter": (
            external["pooled"]["candidateShareMAE"] is not None
            and external["pooled"]["candidateShareMAE"] < external["pooled"]["identityShareMAE"]
        ),
        "passed": external_passed,
    }
    result["externalLevel3"] = external

    structural_passed = (
        transition_min >= -1e-12
        and transition_max <= 1.0 + 1e-12
        and share_sum_max_error <= 1e-10
    )
    lulea1 = result["summary"]["2580"]["1"]
    lulea2 = result["summary"]["2580"]["2"]
    fa1 = result["summary"][b.FA_CODE]["1"]
    fa2 = result["summary"][b.FA_CODE]["2"]
    development_passed = (
        structural_passed
        and lulea1["candidateShareMAE"] is not None
        and fa1["candidateShareMAE"] is not None
        and lulea1["candidateShareMAE"] < lulea1["identityShareMAE"]
        and fa1["candidateShareMAE"] < fa1["identityShareMAE"]
        and lulea2["candidateShareMAE"] <= lulea2["identityShareMAE"]
        and fa2["candidateShareMAE"] <= fa2["identityShareMAE"]
    )
    result["structural"] = {
        "transitionProbabilityMin": transition_min,
        "transitionProbabilityMax": transition_max,
        "maxShareSumError": share_sum_max_error,
        "passed": structural_passed,
    }
    result["developmentGate"] = {
        "status": "development_only_not_promotion_evidence",
        "passed": development_passed,
        "rule": cfg["evaluation"]["developmentGate"],
    }

    write(result)
    print(
        "qutb education diagnostic: "
        f"Lulea n+1 {lulea1['candidateShareMAE']} vs {lulea1['identityShareMAE']}; "
        f"FA n+1 {fa1['candidateShareMAE']} vs {fa1['identityShareMAE']}; "
        f"development gate={development_passed}; "
        f"external gate={result['externalLevel3']['gate']['passed']}"
    )


if __name__ == "__main__":
    main()
