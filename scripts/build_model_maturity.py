#!/usr/bin/env python3
"""Build a machine-readable maturity report for model components."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "data" / "model_maturity_policy.json"
ROLLING = ROOT / "data" / "backtests" / "rolling_2018_2024.json"
VALIDATION = ROOT / "data" / "model_validation.json"
HOLDOUT = ROOT / "data" / "backtests" / "component_flow_holdout.json"
SMOOTHING = ROOT / "data" / "backtests" / "migration_age_smoothing.json"
CONSISTENCY_ADJUSTMENT = ROOT / "data" / "backtests" / "scb_consistency_adjustment.json"
CONSISTENCY_VINTAGE = ROOT / "data" / "backtests" / "scb_consistency_vintage_validation.json"
INDUSTRIAL_SCENARIO_VALIDATION = ROOT / "data" / "backtests" / "industrial_workforce_scenario_validation.json"
INDUSTRIAL_SCENARIO_ENGINE_VALIDATION = ROOT / "data" / "backtests" / "industrial_workforce_scenario_engine_validation.json"
HOUSING_SCENARIO_VALIDATION = ROOT / "data" / "backtests" / "housing_scenario_validation.json"
HOUSEHOLD_PROJECTION_VALIDATION = ROOT / "data" / "backtests" / "household_projection_validation.json"
HOUSEHOLD_PROJECTION_EXTERNAL = ROOT / "data" / "backtests" / "household_projection_external_validation.json"
LABOUR_MARKET_SUPPORT_VALIDATION = ROOT / "data" / "backtests" / "labour_market_support_validation.json"
FADING_POLICY_VALIDATION = ROOT / "data" / "backtests" / "fading_policy_validation.json"
QUTB_VALIDATION = ROOT / "data" / "backtests" / "qutb_neutralization_validation.json"
BASE_POPULATION_BRIDGE_VALIDATION = ROOT / "data" / "backtests" / "base_population_bridge_validation.json"
SEX_RATIO_VALIDATION = ROOT / "data" / "backtests" / "sex_ratio_at_birth_validation.json"
FA_ADDITIVITY_VALIDATION = ROOT / "data" / "backtests" / "fa_additivity_validation.json"
NATIONAL_FUTURE_PROFILES_VALIDATION = ROOT / "data" / "backtests" / "national_future_profiles_validation.json"
SCENARIO_OVERLAP_VALIDATION = ROOT / "data" / "backtests" / "scenario_overlap_control_validation.json"
DEMOGRAPHIC_SENSITIVITY_VALIDATION = ROOT / "data" / "backtests" / "demographic_sensitivity_controls_validation.json"
CKM_UNCERTAINTY_VALIDATION = ROOT / "data" / "backtests" / "ckm_uncertainty_diagnostics_validation.json"
SCENARIO_MIGRATION_PROFILES_VALIDATION = ROOT / "data" / "backtests" / "scenario_migration_profiles_validation.json"
MODEL_DATA_INTEGRITY_VALIDATION = ROOT / "data" / "backtests" / "model_data_integrity_validation.json"
SCENARIO_PHASE_IN_VALIDATION = ROOT / "data" / "backtests" / "scenario_phase_in_validation.json"
POPULATION_ACCOUNTING_VALIDATION = ROOT / "data" / "backtests" / "population_accounting_identity_validation.json"
OUT_JSON = ROOT / "data" / "model_maturity.json"
OUT_JS = ROOT / "data" / "model_maturity.js"

WINDOWS = ("3", "6", "10")
GEOS = ("2580", "FA_LULEA")


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def gate(label, passed, evidence, required=True):
    return {
        "label": label,
        "passed": bool(passed),
        "evidence": evidence,
        "required": bool(required),
    }


def component(policy, key, level, lifecycle, production_active, gates, next_action):
    required = [g for g in gates if g.get("required", True)]
    passed = bool(required) and all(g["passed"] for g in required)
    return {
        "key": key,
        "label": policy["components"][key]["label"],
        "maturityLevel": int(level),
        "maturityName": policy["levels"][str(level)]["name"],
        "lifecycle": lifecycle,
        "productionActive": bool(production_active),
        "targetLevel": int(policy["components"][key]["targetLevel"]),
        "productionGatePassed": passed if level >= 3 else False,
        "requiredGate": policy["components"][key]["requiredGate"],
        "gates": gates,
        "nextAction": next_action,
    }


def main():
    policy = load(POLICY)
    rolling = load(ROLLING)
    validation = load(VALIDATION)
    holdout = load(HOLDOUT)
    smoothing = load(SMOOTHING)

    comps = []

    # Event-age timing: production engine and explicitly compared with legacy.
    timing_checks = []
    for geo in GEOS:
        for w in WINDOWS:
            s = rolling["eventAgeTimingDiagnostic"]["summary"][geo][w]
            timing_checks.append(
                s["alignedPopulationMAE"] < s["legacyPopulationMAE"]
                and s["alignedDeathsMAE"] < s["legacyDeathsMAE"]
            )
    comps.append(component(
        policy, "event_age_timing", 4, "production", True,
        [gate(
            "Aligned timing beats legacy for population and deaths in 3/6/10 for Luleå and FA",
            all(timing_checks),
            f"{sum(timing_checks)}/{len(timing_checks)} window/geography checks passed"
        )],
        "Freeze method; rerun the same gate when annual data are refreshed."
    ))

    # Fertility localization: promote only if the isolated comparator wins
    # in every main window for both Luleå municipality and the FA aggregate.
    fert_rows = validation.get("relativeFactors", {}).get("fertility", [])
    fert_windows = sorted({int(r["window"]) for r in fert_rows if r.get("geo") == "2580"})
    fert_diag = rolling.get("fertilityLocalizationDiagnostic", {}).get("summary", {})
    fert_checks = []
    fert_evidence = []
    for geo in GEOS:
        for w in WINDOWS:
            row = fert_diag.get(geo, {}).get(w)
            if not row:
                fert_checks.append(False)
                fert_evidence.append(f"{geo} w{w}: missing comparator")
                continue
            ok = row["localizedBirthsMAE"] < row["nationalOnlyBirthsMAE"]
            fert_checks.append(ok)
            fert_evidence.append(
                f"{geo} w{w}: {row['localizedBirthsMAE']} < {row['nationalOnlyBirthsMAE']}"
            )
    fertility_gate = len(fert_checks) == 6 and all(fert_checks)
    fertility_level = 4 if fertility_gate else 3
    comps.append(component(
        policy, "fertility_localization", fertility_level,
        "production" if fertility_gate else "active_needs_final_gate", True,
        [
            gate(
                "Local fertility factors exist for all main windows",
                fert_windows == [3, 6, 10],
                f"Luleå windows present: {fert_windows}"
            ),
            gate(
                "Localized fertility beats national-only birth MAE in every 3/6/10 check",
                fertility_gate,
                "; ".join(fert_evidence)
            )
        ],
        (
            "Freeze method; continue annual regression monitoring."
            if fertility_gate
            else "Keep active but below level 4; investigate failed windows without outcome-driven retuning."
        )
    ))

    # Mortality localization.
    mort_checks = []
    mort_evidence = []
    for geo in GEOS:
        for w in WINDOWS:
            s = rolling["mortalityLocalizationDiagnostic"]["summary"][geo][w]
            ok = s["localizedDeathsMAE"] < s["nationalOnlyDeathsMAE"]
            mort_checks.append(ok)
            mort_evidence.append(
                f"{geo} w{w}: {s['localizedDeathsMAE']} < {s['nationalOnlyDeathsMAE']}"
            )
    comps.append(component(
        policy, "mortality_localization", 4, "production", True,
        [gate(
            "Localized mortality beats national-only death MAE in every 3/6/10 check",
            all(mort_checks),
            "; ".join(mort_evidence)
        )],
        "Freeze method; continue annual regression monitoring."
    ))

    # Net10 incumbent.
    net10 = rolling["summary"]["2580"]["10"]
    hgate = (holdout.get("productionGate") or {}).get("passedAllGates")
    if hgate is None:
        hgate = (holdout.get("gate") or {}).get("passedAllGates")
    if hgate is None:
        hgate = (holdout.get("summary") or {}).get("passedAllGates")
    component_failed = hgate is False
    comps.append(component(
        policy, "net_migration_10y", 4, "production", True,
        [
            gate(
                "Vintage-correct rolling-origin exists",
                net10.get("observations", 0) >= 12,
                f"{net10.get('observations', 0)} observations; population MAE {net10.get('populationMAE')}"
            ),
            gate(
                "Locked component-flow challenger did not pass external production gate",
                component_failed,
                f"component-flow external gate passed = {hgate}"
            )
        ],
        "Keep as incumbent until a pre-locked migration candidate passes all replacement gates."
    ))

    # Calibration windows.
    fc = validation.get("faConsistency", {}).get("forecastWindows", {})
    window_ok = all(str(w) in fc and fc[str(w)].get("ok") for w in (3, 6, 10))
    comps.append(component(
        policy, "calibration_windows", 4, "production_support", True,
        [gate(
            "3/6/10 all build with exact FA consistency",
            window_ok,
            ", ".join(f"{w}:{fc.get(str(w),{}).get('ok')}" for w in (3,6,10))
        )],
        "Keep 10 years as default; retain 3 and 6 as sensitivity/regime alternatives."
    ))

    # Component-flow rejected at external holdout.
    cf = rolling["componentFlowDiagnostic"]["summary"]["2580"]
    cf_gate = bool(hgate)
    comps.append(component(
        policy, "component_flow", 2, "rejected", False,
        [
            gate(
                "External pre-declared production gate",
                cf_gate,
                f"passedAllGates={hgate}"
            ),
            gate(
                "n+1 rolling population MAE beats net10",
                cf["oneYear"]["component"]["populationMAE"] < cf["oneYear"]["net10Baseline"]["populationMAE"],
                f"{cf['oneYear']['component']['populationMAE']} vs {cf['oneYear']['net10Baseline']['populationMAE']}"
            )
        ],
        "Retain for research only; do not retune against consumed holdouts."
    ))

    # Recency candidate rejected in full cohort model.
    rec = rolling["componentRecencyDiagnostic"]["summary"]["2580"]
    rec_ok = (
        rec["oneYear"]["componentRecency"]["populationMAE"]
        < rec["oneYear"]["lockedComponent"]["populationMAE"]
        and rec["oneYear"]["componentRecency"]["netMigrationMAE"]
        < rec["oneYear"]["lockedComponent"]["netMigrationMAE"]
    )
    comps.append(component(
        policy, "migration_recency", 2, "rejected", False,
        [gate(
            "Full cohort n+1 improves on locked component-flow",
            rec_ok,
            f"population {rec['oneYear']['componentRecency']['populationMAE']} vs {rec['oneYear']['lockedComponent']['populationMAE']}; "
            f"migration {rec['oneYear']['componentRecency']['netMigrationMAE']} vs {rec['oneYear']['lockedComponent']['netMigrationMAE']}"
        )],
        "No further promotion. Keep diagnostic history to prevent rediscovering the same failed candidate."
    ))

    # Migration age smoothing: existing local+national candidate plus the
    # pre-locked analogue extension. Either may become the validated candidate,
    # but production remains unchanged until an untouched external control.
    smoothing_roll = rolling.get("migrationAgeSmoothingDiagnostic", {})
    smoothing_summary = smoothing_roll.get("summary", {}).get("2580", {})
    existing_smoothing_gate = (
        smoothing_roll.get("existingSmoothingGate") or {}
    ).get("passed") is True
    analogue_smoothing_gate = (
        smoothing_roll.get("analogueSmoothingGate") or {}
    ).get("passed") is True
    smoothing_rolling_available = bool(
        smoothing_summary.get("observations", 0)
    )
    smoothing_validated = (
        existing_smoothing_gate or analogue_smoothing_gate
    )
    smoothing_level = (
        3 if smoothing_validated
        else 2 if smoothing_rolling_available
        else 1
    )
    smoothing_lifecycle = (
        "validated_candidate" if smoothing_validated
        else "rejected" if smoothing_rolling_available
        else "diagnostic"
    )
    smoothing_n1 = smoothing_summary.get("oneYear") or {}
    comps.append(component(
        policy, "migration_age_smoothing", smoothing_level,
        smoothing_lifecycle, False,
        [
            gate(
                "Diagnostic data generated",
                smoothing.get("status") == "diagnostic_only_not_active_in_forecast"
                and len(smoothing.get("allAgeDirectionRows", [])) > 0,
                f"status={smoothing.get('status')}; rows={len(smoothing.get('allAgeDirectionRows', []))}"
            ),
            gate(
                "Existing local+national smoothing passes pre-locked rolling gate",
                existing_smoothing_gate,
                (
                    f"n+1 raw pop/mig={smoothing_n1.get('raw', {}).get('populationMAE')}/"
                    f"{smoothing_n1.get('raw', {}).get('netMigrationMAE')}; "
                    f"local+national={smoothing_n1.get('localNational', {}).get('populationMAE')}/"
                    f"{smoothing_n1.get('localNational', {}).get('netMigrationMAE')}"
                    if smoothing_rolling_available else "Awaiting rolling-origin results"
                )
            ),
            gate(
                "Analogue extension passes pre-locked rolling gate against both comparators",
                analogue_smoothing_gate,
                (
                    f"n+1 analogue pop/mig={smoothing_n1.get('localNationalAnalogue', {}).get('populationMAE')}/"
                    f"{smoothing_n1.get('localNationalAnalogue', {}).get('netMigrationMAE')}"
                    if smoothing_rolling_available else "Awaiting rolling-origin results"
                ),
                required=False
            )
        ],
        (
            "Lock untouched external municipalities before any level-4 evaluation; do not retune smoothing or analogue weights from Luleå outcomes."
            if smoothing_validated
            else "Keep failed locked smoothing candidates out of production; do not retune from these outcomes."
            if smoothing_rolling_available
            else "Run vintage-correct raw vs local+national vs analogue smoothing comparison."
        )
    ))

    # Existing SCB-risk candidate remains development-only.
    risk = rolling["scbRiskFlowDiagnostic"]["summary"]["2580"]
    risk_n1 = risk["oneYear"]
    risk_better_n1 = (
        risk_n1["scbRiskFlow"]["populationMAE"] < risk_n1["net10Baseline"]["populationMAE"]
        and risk_n1["scbRiskFlow"]["netMigrationMAE"] < risk_n1["net10Baseline"]["netMigrationMAE"]
    )
    comps.append(component(
        policy, "scb_risk_flow", 2,
        "validated_candidate" if risk_better_n1 else "rejected_superseded",
        False,
        [gate(
            "Current age/sex risk-flow beats net10 at n+1",
            risk_better_n1,
            f"candidate population/migration MAE="
            f"{risk_n1['scbRiskFlow']['populationMAE']}/"
            f"{risk_n1['scbRiskFlow']['netMigrationMAE']}; "
            f"net10={risk_n1['net10Baseline']['populationMAE']}/"
            f"{risk_n1['net10Baseline']['netMigrationMAE']}; "
            f"passed={risk_better_n1}"
        )],
        (
            "Lock independent external validation before any production consideration."
            if risk_better_n1
            else "Closed: do not retune this approximation; retain results as evidence and use net10 in production."
        )
    ))

    # Profet is an alternative architecture. It is not promoted merely because
    # its pieces are implemented: the locked forecast-quality gates must pass.
    profet_cfg = load(ROOT / "data" / "profet_flow_config.json")
    profet_birth_diag = rolling.get("profetBirthStatusDiagnostic", {})
    profet_birth_summary = profet_birth_diag.get("summary", {}).get("2580", {})
    profet_consistency_diag = rolling.get("profetConsistencyDiagnostic", {})
    profet_consistency_gate = (
        profet_consistency_diag.get("promotionGate") or {}
    ).get("passed") is True
    profet_birth_n1 = profet_birth_summary.get("oneYear") or {}
    profet_birth_n2 = profet_birth_summary.get("twoYear") or {}
    profet_birth_gate = bool(
        profet_birth_n1 and profet_birth_n2
        and profet_birth_n1["profetBirthStatus"]["populationMAE"]
            < profet_birth_n1["net10Baseline"]["populationMAE"]
        and profet_birth_n1["profetBirthStatus"]["netMigrationMAE"]
            < profet_birth_n1["net10Baseline"]["netMigrationMAE"]
        and profet_birth_n2["profetBirthStatus"]["populationMAE"]
            <= profet_birth_n2["net10Baseline"]["populationMAE"]
        and profet_birth_n2["profetBirthStatus"]["netMigrationMAE"]
            <= profet_birth_n2["net10Baseline"]["netMigrationMAE"]
    )
    profet_current_architecture_passes = (
        risk_better_n1 and profet_birth_gate and profet_consistency_gate
    )
    profet_has_results = bool(profet_birth_summary and profet_consistency_diag.get("summary"))
    comps.append(component(
        policy, "profet_flow", 2,
        (
            "development" if not profet_has_results
            else "validated_candidate" if profet_current_architecture_passes
            else "rejected_current_architecture"
        ),
        False,
        [
            gate(
                "Method locked from public sources",
                "locked" in profet_cfg.get("status", ""),
                profet_cfg.get("status")
            ),
            gate(
                "Base SCB-risk migration increment passes locked comparator",
                risk_better_n1,
                f"passed={risk_better_n1}"
            ),
            gate(
                "Birth-status increment passes locked n+1/n+2 comparator",
                profet_birth_gate,
                f"passed={profet_birth_gate}"
            ),
            gate(
                "Municipality→county consistency increment passes locked accuracy comparator",
                profet_consistency_gate,
                f"passed={profet_consistency_gate}"
            ),
            gate(
                "County→national consistency layer active",
                False,
                "Not implemented because the preceding forecast-quality increments did not qualify for promotion.",
                required=False
            )
        ],
        (
            "Lock a genuinely new Profet architecture before any new outcome evaluation; do not retune the consumed risk, birth-status or consistency candidates."
            if profet_has_results and not profet_current_architecture_passes
            else "Continue only after all locked incremental gates pass."
        )
    ))

    birth_diag = rolling.get("profetBirthStatusDiagnostic", {}).get("summary", {})
    birth_lulea = birth_diag.get("2580", {})
    birth_n1 = birth_lulea.get("oneYear")
    birth_n2 = birth_lulea.get("twoYear")
    birth_gate_checks = []
    birth_evidence = []
    if birth_n1 and birth_n2:
        c1 = birth_n1["profetBirthStatus"]["populationMAE"] < birth_n1["net10Baseline"]["populationMAE"]
        c2 = birth_n1["profetBirthStatus"]["netMigrationMAE"] < birth_n1["net10Baseline"]["netMigrationMAE"]
        c3 = birth_n2["profetBirthStatus"]["populationMAE"] <= birth_n2["net10Baseline"]["populationMAE"]
        c4 = birth_n2["profetBirthStatus"]["netMigrationMAE"] <= birth_n2["net10Baseline"]["netMigrationMAE"]
        birth_gate_checks = [c1, c2, c3, c4]
        birth_evidence = [
            f"n+1 population candidate={birth_n1['profetBirthStatus']['populationMAE']}, "
            f"net10={birth_n1['net10Baseline']['populationMAE']}, passed={c1}",
            f"n+1 migration candidate={birth_n1['profetBirthStatus']['netMigrationMAE']}, "
            f"net10={birth_n1['net10Baseline']['netMigrationMAE']}, passed={c2}",
            f"n+2 population candidate={birth_n2['profetBirthStatus']['populationMAE']}, "
            f"net10={birth_n2['net10Baseline']['populationMAE']}, passed={c3}",
            f"n+2 migration candidate={birth_n2['profetBirthStatus']['netMigrationMAE']}, "
            f"net10={birth_n2['net10Baseline']['netMigrationMAE']}, passed={c4}",
        ]
    birth_gate = len(birth_gate_checks) == 4 and all(birth_gate_checks)
    birth_has_rolling = bool(birth_n1 and birth_n2)
    birth_level = 3 if birth_gate else 2
    comps.append(component(
        policy, "birth_status", birth_level,
        (
            "validated_candidate" if birth_gate
            else "rejected" if birth_has_rolling
            else "development"
        ), False,
        [
            gate(
                "Source data configured",
                True,
                "Population and all six migration flows are available by Swedish-/foreign-born, age and sex."
            ),
            gate(
                "Birth-status state runs in the cohort engine",
                birth_has_rolling,
                "Rolling-origin Profet birth-status diagnostic generated" if birth_has_rolling else "Awaiting rolling-origin run"
            ),
            gate(
                "Pre-locked Luleå n+1/n+2 promotion gate",
                birth_gate,
                "; ".join(birth_evidence) if birth_evidence else "Awaiting rolling-origin results"
            )
        ],
        (
            "Lock new external municipalities before any level-4 evaluation."
            if birth_gate
            else "Closed: keep at level 2, do not retune birth-status parameters from these consumed outcomes."
        )
    ))

    consistency_diag_exists = (
        ROOT / "data" / "backtests" / "scb_consistency_diagnostic.json"
    ).exists()
    consistency_adjustment = (
        load(CONSISTENCY_ADJUSTMENT)
        if CONSISTENCY_ADJUSTMENT.exists()
        else {}
    )
    consistency_mass_ok = (
        consistency_adjustment.get("massPreserving") is True
        and float(consistency_adjustment.get("maxAbsoluteResidual", 1.0)) < 1e-8
    )
    consistency_vintage = (
        load(CONSISTENCY_VINTAGE)
        if CONSISTENCY_VINTAGE.exists()
        else {}
    )
    consistency_vintage_ok = (
        consistency_vintage.get("allRequiredVintagesAvailable") is True
        and consistency_vintage.get("allPassed") is True
        and float(consistency_vintage.get("maxAbsoluteResidual", 1.0)) < 1e-8
    )
    consistency_accuracy = rolling.get("profetConsistencyDiagnostic", {})
    consistency_accuracy_gate = consistency_accuracy.get("promotionGate") or {}
    consistency_accuracy_ok = consistency_accuracy_gate.get("passed") is True
    # Structural mass-balance checks are necessary but not sufficient for
    # level 3 under the maturity policy. Level 3 requires a passed rolling
    # forecast-quality comparator.
    consistency_level = (
        3 if consistency_accuracy_ok
        else 2 if consistency_mass_ok or consistency_vintage_ok
        else 1
    )
    consistency_lifecycle = (
        "validated_candidate" if consistency_accuracy_ok
        else "rejected" if consistency_accuracy_gate
        else "development" if consistency_mass_ok or consistency_vintage_ok
        else "diagnostic"
    )
    comps.append(component(
        policy, "consistency_adjustment", consistency_level,
        consistency_lifecycle, False,
        [
            gate(
                "Municipality-county consistency diagnostic exists",
                consistency_diag_exists,
                "SCB municipality-county accounting diagnostic available."
                if consistency_diag_exists
                else "Consistency diagnostic missing."
            ),
            gate(
                "Mass-preserving municipality-to-county adjustment implemented",
                consistency_mass_ok,
                (
                    "max residual "
                    + str(consistency_adjustment.get("maxAbsoluteResidual"))
                    + "; national layer remains inactive"
                )
                if consistency_adjustment
                else "Awaiting generated adjustment diagnostic."
            ),
            gate(
                "Locked adjustment passes frozen SCB 2020/2021/2022 vintages",
                consistency_vintage_ok,
                (
                    "vintages="
                    + str(consistency_vintage.get("availableVintages"))
                    + "; max residual="
                    + str(consistency_vintage.get("maxAbsoluteResidual"))
                )
                if consistency_vintage
                else "Awaiting frozen-vintage validation."
            ),
            gate(
                "Profet with municipality→county adjustment meets pre-locked accuracy gate",
                consistency_accuracy_ok,
                (
                    "checks=" + str(consistency_accuracy_gate.get("checks"))
                )
                if consistency_accuracy_gate
                else "Awaiting with/without Profet accuracy comparison."
            )
        ],
        (
            "Add county→national support and an untouched external holdout before any level-4 promotion."
            if consistency_accuracy_ok
            else "Closed at level 2: structural accounting passed but the locked with/without forecast-accuracy gate failed; do not retune from these outcomes."
            if consistency_accuracy_gate
            else "Complete a locked with/without rolling forecast comparison before any level-3 promotion."
            if consistency_mass_ok or consistency_vintage_ok
            else "Build the locked mass-preserving municipality→county adjustment."
        )
    ))

    industrial_cfg = load(ROOT / "data" / "industrial_workforce_scenario_config.json")
    industrial_validation = (
        load(INDUSTRIAL_SCENARIO_VALIDATION)
        if INDUSTRIAL_SCENARIO_VALIDATION.exists()
        else {}
    )
    industrial_presets = industrial_cfg.get("sensitivityPresets") or {}
    industrial_ranges = industrial_cfg.get("parameterRanges") or {}
    industrial_structure_ok = (
        industrial_validation.get("allPassed") is True
        and all(k in industrial_presets for k in ("low", "reference", "high"))
        and len(industrial_ranges) >= 5
    )
    industrial_engine_validation = (
        load(INDUSTRIAL_SCENARIO_ENGINE_VALIDATION)
        if INDUSTRIAL_SCENARIO_ENGINE_VALIDATION.exists()
        else {}
    )
    industrial_engine_ok = (
        industrial_engine_validation.get("allPassed") is True
    )
    industrial_level = (
        4 if industrial_structure_ok and industrial_engine_ok
        else 3 if industrial_structure_ok
        else 2
    )
    industrial_lifecycle = (
        "production_ready_scenario" if industrial_level == 4
        else "validated_scenario" if industrial_level == 3
        else "development_scenario"
    )
    comps.append(component(
        policy, "industrial_workforce_scenario", industrial_level,
        industrial_lifecycle, False,
        [
            gate(
                "Scenario is explicitly excluded from baseline",
                industrial_cfg.get("baselineExcluded") is True,
                "baselineExcluded=true"
            ),
            gate(
                "International recruitment share is explicit",
                "internationalRecruitmentSharePct" in industrial_cfg.get("fields", {}),
                "Explicit Sweden/international split is available"
            ),
            gate(
                "Low/reference/high sensitivity presets and parameter ranges documented",
                bool(industrial_presets) and len(industrial_ranges) >= 5,
                (
                    f"presets={list(industrial_presets)}; ranges={list(industrial_ranges)}"
                    if industrial_presets else "Scenario presets missing"
                )
            ),
            gate(
                "Scenario structure validation passes",
                industrial_validation.get("allPassed") is True,
                (
                    f"checks={industrial_validation.get('checks')}"
                    if industrial_validation else "Awaiting structural validation"
                )
            ),
            gate(
                "End-to-end scenario engine regression passes",
                industrial_engine_ok,
                (
                    f"checks={industrial_engine_validation.get('checks')}"
                    if industrial_engine_validation
                    else "Awaiting engine regression"
                )
            )
        ],
        (
            "Keep presets as sensitivity scenarios, never baseline assumptions; rerun structural and engine regression tests whenever scenario mechanics change."
            if industrial_level == 4
            else "Run end-to-end preset regression through the scenario engine before level 4."
            if industrial_level == 3
            else "Complete documented presets/ranges and structural validation."
        )
    ))

    housing_cfg = load(ROOT / "data" / "housing_scenario_config.json")
    housing_validation = (
        load(HOUSING_SCENARIO_VALIDATION)
        if HOUSING_SCENARIO_VALIDATION.exists()
        else {}
    )
    housing_engine_ok = housing_validation.get("allPassed") is True
    housing_ranges = housing_cfg.get("parameterRanges") or {}
    housing_presets = housing_cfg.get("sensitivityPresets") or {}
    housing_structure_ok = (
        housing_cfg.get("baselineExcluded") is True
        and len(housing_ranges) >= 6
        and all(k in housing_presets for k in ("low", "reference", "high"))
    )
    housing_level = (
        4 if housing_structure_ok and housing_engine_ok
        else 3 if housing_structure_ok
        else 2
    )
    comps.append(component(
        policy, "housing_scenario", housing_level,
        (
            "production_ready_scenario" if housing_level == 4
            else "validated_scenario" if housing_level == 3
            else "development_scenario"
        ),
        False,
        [
            gate(
                "Housing scenario is explicitly excluded from baseline",
                housing_cfg.get("baselineExcluded") is True,
                "baselineExcluded=true"
            ),
            gate(
                "Low/reference/high presets and parameter ranges documented",
                housing_structure_ok,
                f"presets={list(housing_presets)}; ranges={list(housing_ranges)}"
            ),
            gate(
                "End-to-end housing scenario regression passes",
                housing_engine_ok,
                (
                    f"checks={housing_validation.get('checks')}"
                    if housing_validation
                    else "Awaiting housing scenario engine regression"
                )
            )
        ],
        (
            "Keep housing presets as sensitivity scenarios; rerun regression whenever scenario mechanics or SCB occupancy-default logic changes."
            if housing_level == 4
            else "Complete deterministic engine regression before level 4."
            if housing_level == 3
            else "Complete documented housing scenario presets and ranges."
        )
    ))

    household_cfg = load(ROOT / "data" / "household_projection_config.json")
    household_validation = (
        load(HOUSEHOLD_PROJECTION_VALIDATION)
        if HOUSEHOLD_PROJECTION_VALIDATION.exists()
        else {}
    )
    household_has_results = bool(household_validation.get("checks"))
    household_constant_gate = household_validation.get("allPassed") is True
    household_external = (
        load(HOUSEHOLD_PROJECTION_EXTERNAL)
        if HOUSEHOLD_PROJECTION_EXTERNAL.exists()
        else {}
    )
    household_external_has_results = (
        household_external.get("status") in {
            "passed_external_gate", "failed_external_gate"
        }
    )
    household_trend_external_gate = (
        household_external.get("allPassed") is True
        and household_external.get("status") == "passed_external_gate"
    )
    household_level = (
        4 if household_constant_gate or household_trend_external_gate
        else 2 if household_has_results
        else 1
    )
    household_lifecycle = (
        "production_support" if household_level == 4
        else "development_candidate" if household_has_results and not household_external_has_results
        else "rejected" if household_external_has_results
        else "diagnostic"
    )
    household_production_active = household_constant_gate or household_trend_external_gate
    comps.append(component(
        policy, "household_projection", household_level,
        household_lifecycle,
        household_production_active,
        [
            gate(
                "Validation gate locked before results",
                household_cfg.get("status") == "validation_gate_locked_before_results",
                household_cfg.get("status")
            ),
            gate(
                "Current constant mode passes locked Luleå/FA rolling gate",
                household_constant_gate,
                (
                    f"checks={household_validation.get('checks')}"
                    if household_has_results else "Awaiting rolling validation"
                ),
                required=False
            ),
            gate(
                "Pre-declared five-year trend passes locked independent external holdout gate",
                household_trend_external_gate,
                (
                    f"status={household_external.get('status')}; "
                    f"checks={household_external.get('checks')}; "
                    f"wins={household_external.get('wins')}"
                    if household_external else "Awaiting full SCB refresh / external validation"
                )
            )
        ],
        (
            "Switch the UI production-support default to five-year trend and keep constant/manual as sensitivities; rerun the same external gate on future data refreshes."
            if household_trend_external_gate and not household_constant_gate
            else "Keep constant latest persons-per-household as production-support default; rerun validation when household data refresh."
            if household_constant_gate
            else "Await independent external household trend validation; do not retune the five-year window, caps, holdouts or thresholds."
            if household_has_results and not household_external_has_results
            else "External trend gate failed; keep household projection below production maturity and retain results without retuning."
            if household_external_has_results
            else "Run the locked rolling household projection validation."
        )
    ))

    labour_support_cfg = load(ROOT / "data" / "labour_market_support_config.json")
    labour_support_validation = (
        load(LABOUR_MARKET_SUPPORT_VALIDATION)
        if LABOUR_MARKET_SUPPORT_VALIDATION.exists()
        else {}
    )
    labour_support_gate = labour_support_validation.get("allPassed") is True
    labour_support_has_results = bool(labour_support_validation.get("checks"))
    comps.append(component(
        policy, "labour_market_support",
        4 if labour_support_gate else 2 if labour_support_has_results else 1,
        (
            "production_support" if labour_support_gate
            else "rejected" if labour_support_has_results
            else "diagnostic"
        ),
        labour_support_gate,
        [
            gate(
                "Labour support validation gate locked before results",
                labour_support_cfg.get("status") == "validation_gate_locked_before_results",
                labour_support_cfg.get("status")
            ),
            gate(
                "SCB commuting and worker-age support layer passes structural validation",
                labour_support_gate,
                (
                    f"checks={labour_support_validation.get('checks')}"
                    if labour_support_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Keep as production support; rerun structural validation on every SCB refresh and keep the 2024 method-break note visible."
            if labour_support_gate
            else "Keep below production maturity; investigate source/aggregation defects without changing the locked accounting rules."
            if labour_support_has_results
            else "Run the locked labour-market support validation."
        )
    ))

    fading_cfg = load(ROOT / "data" / "fading_policy_config.json")
    fading_validation = (
        load(FADING_POLICY_VALIDATION)
        if FADING_POLICY_VALIDATION.exists()
        else {}
    )
    fading_gate = fading_validation.get("allPassed") is True
    fading_has_results = bool(fading_validation.get("checks"))
    comps.append(component(
        policy, "fading_policy",
        4 if fading_gate else 2 if fading_has_results else 1,
        (
            "production_support" if fading_gate
            else "rejected" if fading_has_results
            else "diagnostic"
        ),
        fading_gate,
        [
            gate(
                "Fading thresholds and policy are explicitly documented",
                fading_cfg.get("status") == "production_policy_audit_locked",
                fading_cfg.get("status")
            ),
            gate(
                "Information-based fading audit and downstream rolling evidence pass",
                fading_gate,
                (
                    f"checks={fading_validation.get('checks')}"
                    if fading_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Freeze thresholds; rerun the audit whenever fertility/mortality calibration or fading mechanics change."
            if fading_gate
            else "Keep below production maturity; do not tune fading thresholds from consumed forecast outcomes."
            if fading_has_results
            else "Run the production fading-policy audit."
        )
    ))

    qutb_cfg = load(ROOT / "data" / "qutb_neutralization_config.json")
    qutb_validation = (
        load(QUTB_VALIDATION)
        if QUTB_VALIDATION.exists()
        else {}
    )
    qutb_gate = qutb_validation.get("allPassed") is True
    qutb_has_results = bool(qutb_validation.get("checks"))
    comps.append(component(
        policy, "qutb_neutralization",
        4 if qutb_gate else 2 if qutb_has_results else 1,
        (
            "production_support" if qutb_gate
            else "rejected" if qutb_has_results
            else "diagnostic"
        ),
        qutb_gate,
        [
            gate(
                "Neutral qutb mode is explicitly documented",
                qutb_cfg.get("status") == "production_neutralization_locked"
                and qutb_cfg.get("productionMode") == "identity",
                f"status={qutb_cfg.get('status')}; mode={qutb_cfg.get('productionMode')}"
            ),
            gate(
                "Identity qutb regression has zero forecast effect",
                qutb_gate,
                (
                    f"checks={qutb_validation.get('checks')}"
                    if qutb_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Keep identity qutb as the explicit V1 production placeholder; treat any future non-identity education-transition model as a new pre-declared candidate."
            if qutb_gate
            else "Keep qutb below production maturity until identity/no-effect regression passes."
            if qutb_has_results
            else "Run the locked qutb neutralization regression."
        )
    ))

    base_bridge_cfg = load(ROOT / "data" / "base_population_bridge_config.json")
    base_bridge_validation = (
        load(BASE_POPULATION_BRIDGE_VALIDATION)
        if BASE_POPULATION_BRIDGE_VALIDATION.exists()
        else {}
    )
    base_bridge_gate = base_bridge_validation.get("allPassed") is True
    base_bridge_has_results = bool(base_bridge_validation.get("checks"))
    comps.append(component(
        policy, "base_population_ckm_bridge",
        4 if base_bridge_gate else 2 if base_bridge_has_results else 1,
        (
            "production_support" if base_bridge_gate
            else "rejected" if base_bridge_has_results
            else "diagnostic"
        ),
        base_bridge_gate,
        [
            gate(
                "2024→2025 method bridge is explicitly documented",
                base_bridge_cfg.get("status") == "production_bridge_locked",
                base_bridge_cfg.get("status")
            ),
            gate(
                "CKM base population and pre-CKM calibration separation validate",
                base_bridge_gate,
                (
                    f"checks={base_bridge_validation.get('checks')}"
                    if base_bridge_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Keep the bridge explicit on every base-year rollover; never extend pre-CKM calibration across the method break implicitly."
            if base_bridge_gate
            else "Keep below production maturity until base-stock completeness and method-break separation pass."
            if base_bridge_has_results
            else "Run the locked base-population bridge validation."
        )
    ))

    sex_ratio_cfg = load(ROOT / "data" / "sex_ratio_at_birth_config.json")
    sex_ratio_validation = (
        load(SEX_RATIO_VALIDATION)
        if SEX_RATIO_VALIDATION.exists()
        else {}
    )
    sex_ratio_gate = sex_ratio_validation.get("allPassed") is True
    sex_ratio_has_results = bool(sex_ratio_validation.get("checks"))
    comps.append(component(
        policy, "sex_ratio_at_birth",
        4 if sex_ratio_gate else 2 if sex_ratio_has_results else 1,
        (
            "production_support" if sex_ratio_gate
            else "rejected" if sex_ratio_has_results
            else "diagnostic"
        ),
        sex_ratio_gate,
        [
            gate(
                "Raps newborn sex split is explicitly documented",
                sex_ratio_cfg.get("status") == "production_parameter_locked"
                and float(sex_ratio_cfg.get("maleShare", 0)) == 0.515,
                f"status={sex_ratio_cfg.get('status')}; maleShare={sex_ratio_cfg.get('maleShare')}"
            ),
            gate(
                "Sex-ratio regression and total-birth invariance pass",
                sex_ratio_gate,
                (
                    f"checks={sex_ratio_validation.get('checks')}"
                    if sex_ratio_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Freeze 0.515/0.485 as the Raps production parameter; keep local observed sex share diagnostic only."
            if sex_ratio_gate
            else "Keep below production maturity until source, split and newborn-allocation regression pass."
            if sex_ratio_has_results
            else "Run the locked sex-ratio validation."
        )
    ))

    fa_add_cfg = load(ROOT / "data" / "fa_additivity_config.json")
    fa_add_validation = (
        load(FA_ADDITIVITY_VALIDATION)
        if FA_ADDITIVITY_VALIDATION.exists()
        else {}
    )
    fa_add_gate = fa_add_validation.get("allPassed") is True
    fa_add_has_results = bool(fa_add_validation.get("checks"))
    comps.append(component(
        policy, "fa_additivity",
        4 if fa_add_gate else 2 if fa_add_has_results else 1,
        (
            "production_support" if fa_add_gate
            else "rejected" if fa_add_has_results
            else "diagnostic"
        ),
        fa_add_gate,
        [
            gate(
                "FA membership and additive production rule are explicitly locked",
                fa_add_cfg.get("status") == "production_rule_locked"
                and len(fa_add_cfg.get("members") or []) == 5,
                f"status={fa_add_cfg.get('status')}; members={fa_add_cfg.get('members')}"
            ),
            gate(
                "Baseline and scenario FA additivity regression passes",
                fa_add_gate,
                (
                    f"checks={fa_add_validation.get('checks')}"
                    if fa_add_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Freeze additive FA publication logic; rerun regression whenever simulation aggregation or FA membership changes."
            if fa_add_gate
            else "Keep below production maturity until baseline/scenario additivity and FA gross-flow suppression pass."
            if fa_add_has_results
            else "Run the locked FA-additivity validation."
        )
    ))

    future_profiles_cfg = load(ROOT / "data" / "national_future_profiles_config.json")
    future_profiles_validation = (
        load(NATIONAL_FUTURE_PROFILES_VALIDATION)
        if NATIONAL_FUTURE_PROFILES_VALIDATION.exists()
        else {}
    )
    future_profiles_gate = future_profiles_validation.get("allPassed") is True
    future_profiles_has_results = bool(future_profiles_validation.get("checks"))
    comps.append(component(
        policy, "national_future_profiles",
        4 if future_profiles_gate else 2 if future_profiles_has_results else 1,
        (
            "production_support" if future_profiles_gate
            else "rejected" if future_profiles_has_results
            else "diagnostic"
        ),
        future_profiles_gate,
        [
            gate(
                "National future-profile production gate is explicitly locked",
                future_profiles_cfg.get("status") == "production_input_gate_locked",
                future_profiles_cfg.get("status")
            ),
            gate(
                "Ten-year fertility/mortality coverage and scenario separation validate",
                future_profiles_gate,
                (
                    f"checks={future_profiles_validation.get('checks')}"
                    if future_profiles_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Keep SCB 2024/Raps as production baseline and SCB 2026 fertility as an explicit sensitivity until a separately validated baseline update is approved."
            if future_profiles_gate
            else "Keep below production maturity until the supported ten-year future-profile coverage is complete."
            if future_profiles_has_results
            else "Run the locked future-profile coverage validation."
        )
    ))

    overlap_cfg = load(ROOT / "data" / "scenario_overlap_control_config.json")
    overlap_validation = (
        load(SCENARIO_OVERLAP_VALIDATION)
        if SCENARIO_OVERLAP_VALIDATION.exists()
        else {}
    )
    overlap_gate = overlap_validation.get("allPassed") is True
    overlap_has_results = bool(overlap_validation.get("checks"))
    comps.append(component(
        policy, "scenario_overlap_control",
        4 if overlap_gate else 2 if overlap_has_results else 1,
        (
            "production_support" if overlap_gate
            else "rejected" if overlap_has_results
            else "diagnostic"
        ),
        overlap_gate,
        [
            gate(
                "Overlap control is explicitly documented as a scenario assumption",
                overlap_cfg.get("status") == "production_scenario_control_locked",
                overlap_cfg.get("status")
            ),
            gate(
                "Overlap clamp, monotonicity and no-scenario neutrality pass",
                overlap_gate,
                (
                    f"checks={overlap_validation.get('checks')}"
                    if overlap_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Keep the overlap percentage user-controlled and outside the baseline; rerun regression whenever scenario aggregation changes."
            if overlap_gate
            else "Keep below production maturity until bounded/no-double-count regression passes."
            if overlap_has_results
            else "Run the locked scenario-overlap regression."
        )
    ))

    sensitivity_cfg = load(ROOT / "data" / "demographic_sensitivity_controls_config.json")
    sensitivity_validation = (
        load(DEMOGRAPHIC_SENSITIVITY_VALIDATION)
        if DEMOGRAPHIC_SENSITIVITY_VALIDATION.exists()
        else {}
    )
    sensitivity_gate = sensitivity_validation.get("allPassed") is True
    sensitivity_has_results = bool(sensitivity_validation.get("checks"))
    comps.append(component(
        policy, "demographic_sensitivity_controls",
        4 if sensitivity_gate else 2 if sensitivity_has_results else 1,
        (
            "production_support" if sensitivity_gate
            else "rejected" if sensitivity_has_results
            else "diagnostic"
        ),
        sensitivity_gate,
        [
            gate(
                "Sensitivity controls and neutral value are explicitly documented",
                sensitivity_cfg.get("status") == "production_sensitivity_controls_locked"
                and float(sensitivity_cfg.get("neutralValue", 0)) == 1.0,
                f"status={sensitivity_cfg.get('status')}; neutral={sensitivity_cfg.get('neutralValue')}"
            ),
            gate(
                "Neutrality and component-isolation regression passes",
                sensitivity_gate,
                (
                    f"checks={sensitivity_validation.get('checks')}"
                    if sensitivity_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Keep 1/1/1 as the UI baseline and treat all non-neutral multipliers as explicit sensitivities only."
            if sensitivity_gate
            else "Keep below production maturity until neutral and zero-effect regressions pass."
            if sensitivity_has_results
            else "Run the locked demographic-sensitivity regression."
        )
    ))

    ckm_cfg = load(ROOT / "data" / "ckm_uncertainty_diagnostics_config.json")
    ckm_validation = (
        load(CKM_UNCERTAINTY_VALIDATION)
        if CKM_UNCERTAINTY_VALIDATION.exists()
        else {}
    )
    ckm_gate = ckm_validation.get("allPassed") is True
    ckm_has_results = bool(ckm_validation.get("checks"))
    comps.append(component(
        policy, "ckm_uncertainty_diagnostics",
        4 if ckm_gate else 2 if ckm_has_results else 1,
        (
            "production_support" if ckm_gate
            else "rejected" if ckm_has_results
            else "diagnostic"
        ),
        ckm_gate,
        [
            gate(
                "CKM sensitivity policy is explicitly documented",
                ckm_cfg.get("status") == "production_diagnostic_policy_locked"
                and float(ckm_cfg.get("cellDelta", 0)) == 3.0,
                f"status={ckm_cfg.get('status')}; delta={ckm_cfg.get('cellDelta')}"
            ),
            gate(
                "CKM bounds, method-break separation and interpretation validate",
                ckm_gate,
                (
                    f"checks={ckm_validation.get('checks')}"
                    if ckm_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Keep CKM output as sensitivity diagnostics only; rerun whenever disclosure methodology or method-break treatment changes."
            if ckm_gate
            else "Keep below production maturity until bounds and method-break separation pass."
            if ckm_has_results
            else "Run the locked CKM diagnostic validation."
        )
    ))

    scenario_profiles_cfg = load(ROOT / "data" / "scenario_migration_profiles_config.json")
    scenario_profiles_validation = (
        load(SCENARIO_MIGRATION_PROFILES_VALIDATION)
        if SCENARIO_MIGRATION_PROFILES_VALIDATION.exists()
        else {}
    )
    scenario_profiles_gate = scenario_profiles_validation.get("allPassed") is True
    scenario_profiles_has_results = bool(scenario_profiles_validation.get("checks"))
    comps.append(component(
        policy, "scenario_migration_profiles",
        4 if scenario_profiles_gate else 2 if scenario_profiles_has_results else 1,
        (
            "production_support" if scenario_profiles_gate
            else "rejected" if scenario_profiles_has_results
            else "diagnostic"
        ),
        scenario_profiles_gate,
        [
            gate(
                "Scenario migration profile gate is explicitly locked",
                scenario_profiles_cfg.get("status") == "production_scenario_profile_gate_locked",
                scenario_profiles_cfg.get("status")
            ),
            gate(
                "Profile sums, supports and SCB worker-target reconciliation pass",
                scenario_profiles_gate,
                (
                    f"checks={scenario_profiles_validation.get('checks')}"
                    if scenario_profiles_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Keep profiles as descriptive scenario priors only; rerun validation whenever labour-market structure or scenario age-profile mechanics change."
            if scenario_profiles_gate
            else "Keep below production maturity until all profile accounting and SCB target reconciliations pass."
            if scenario_profiles_has_results
            else "Run the locked scenario-profile validation."
        )
    ))

    integrity_cfg = load(ROOT / "data" / "model_data_integrity_config.json")
    integrity_validation = (
        load(MODEL_DATA_INTEGRITY_VALIDATION)
        if MODEL_DATA_INTEGRITY_VALIDATION.exists()
        else {}
    )
    integrity_gate = integrity_validation.get("allPassed") is True
    integrity_has_results = bool(integrity_validation.get("checks"))
    comps.append(component(
        policy, "model_data_integrity",
        4 if integrity_gate else 2 if integrity_has_results else 1,
        (
            "production_support" if integrity_gate
            else "rejected" if integrity_has_results
            else "diagnostic"
        ),
        integrity_gate,
        [
            gate(
                "Core model-data integrity gate is explicitly locked",
                integrity_cfg.get("status") == "production_data_integrity_gate_locked",
                integrity_cfg.get("status")
            ),
            gate(
                "Completeness, uniqueness and numeric-integrity checks pass",
                integrity_gate,
                (
                    f"checks={integrity_validation.get('checks')}; "
                    f"counts={integrity_validation.get('counts')}"
                    if integrity_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Keep as a hard production-build gate; rerun after every SCB refresh and model-data schema change."
            if integrity_gate
            else "Block production maturity until missing/duplicate/invalid core cells are corrected without silent imputation."
            if integrity_has_results
            else "Run the locked core model-data integrity validation."
        )
    ))

    phase_cfg = load(ROOT / "data" / "scenario_phase_in_config.json")
    phase_validation = (
        load(SCENARIO_PHASE_IN_VALIDATION)
        if SCENARIO_PHASE_IN_VALIDATION.exists()
        else {}
    )
    phase_gate = phase_validation.get("allPassed") is True
    phase_has_results = bool(phase_validation.get("checks"))
    comps.append(component(
        policy, "scenario_phase_in",
        4 if phase_gate else 2 if phase_has_results else 1,
        (
            "production_support" if phase_gate
            else "rejected" if phase_has_results
            else "diagnostic"
        ),
        phase_gate,
        [
            gate(
                "Scenario phase-in rule is explicitly documented",
                phase_cfg.get("status") == "production_scenario_phase_gate_locked",
                phase_cfg.get("status")
            ),
            gate(
                "Timing-window and cumulative-magnitude regressions pass",
                phase_gate,
                (
                    f"checks={phase_validation.get('checks')}; "
                    f"examples={phase_validation.get('examples')}"
                    if phase_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Keep uniform phase-in as the production scenario timing rule; validate any future non-uniform ramp separately."
            if phase_gate
            else "Keep below production maturity until timing and cumulative-conservation checks pass."
            if phase_has_results
            else "Run the locked scenario phase-in validation."
        )
    ))

    accounting_cfg = load(ROOT / "data" / "population_accounting_identity_config.json")
    accounting_validation = (
        load(POPULATION_ACCOUNTING_VALIDATION)
        if POPULATION_ACCOUNTING_VALIDATION.exists()
        else {}
    )
    accounting_gate = accounting_validation.get("allPassed") is True
    accounting_has_results = bool(accounting_validation.get("checks"))
    comps.append(component(
        policy, "population_accounting_identity",
        4 if accounting_gate else 2 if accounting_has_results else 1,
        (
            "production_support" if accounting_gate
            else "rejected" if accounting_has_results
            else "diagnostic"
        ),
        accounting_gate,
        [
            gate(
                "Population accounting rule is explicitly documented",
                accounting_cfg.get("status") == "production_accounting_gate_locked",
                accounting_cfg.get("status")
            ),
            gate(
                "Annual demographic balance and prior-year reconciliation pass",
                accounting_gate,
                (
                    f"checks={accounting_validation.get('checks')}; "
                    f"maxIdentityResidual={accounting_validation.get('maxIdentityResidual')}; "
                    f"maxPopulationResidual={accounting_validation.get('maxPopulationResidual')}"
                    if accounting_has_results else "Awaiting validation"
                )
            )
        ],
        (
            "Keep as a hard production invariant for every municipality/FA and every baseline/scenario run."
            if accounting_gate
            else "Block production maturity until all annual accounting residuals are zero within tolerance."
            if accounting_has_results
            else "Run the locked population-accounting validation."
        )
    ))

    counts = {str(i): sum(c["maturityLevel"] == i for c in comps) for i in range(1,5)}
    report = {
        "schemaVersion": "0.1.0",
        "generatedBy": "scripts/build_model_maturity.py",
        "levels": policy["levels"],
        "principles": policy["principles"],
        "summary": {
            "componentCount": len(comps),
            "byLevel": counts,
            "productionLevel4": [c["key"] for c in comps if c["maturityLevel"] == 4],
            "rejected": [c["key"] for c in comps if c["lifecycle"] == "rejected"]
        },
        "components": comps
    }
    OUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    OUT_JS.write_text(
        "window.MODEL_MATURITY = " + json.dumps(report, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8"
    )
    print(f"Wrote {OUT_JSON.relative_to(ROOT)} and {OUT_JS.relative_to(ROOT)}")
    for c in comps:
        print(f"L{c['maturityLevel']} {c['label']} [{c['lifecycle']}]")

if __name__ == "__main__":
    main()
