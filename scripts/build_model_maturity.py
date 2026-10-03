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
        policy, "scb_risk_flow", 2, "development", False,
        [gate(
            "Current age/sex risk-flow beats net10 at n+1",
            risk_better_n1,
            f"population {risk_n1['scbRiskFlow']['populationMAE']} vs {risk_n1['net10Baseline']['populationMAE']}; "
            f"migration {risk_n1['scbRiskFlow']['netMigrationMAE']} vs {risk_n1['net10Baseline']['netMigrationMAE']}"
        )],
        "Supersede with the more faithful Profet implementation rather than tuning this approximation."
    ))

    # Profet, birth status, consistency, scenario are structural states.
    profet_cfg = load(ROOT / "data" / "profet_flow_config.json")
    comps.append(component(
        policy, "profet_flow", 2, "development", False,
        [
            gate("Method locked from public sources", "locked" in profet_cfg.get("status", ""), profet_cfg.get("status")),
            gate(
                "Birth-status state implemented in development cohort engine",
                bool(rolling.get("profetBirthStatusDiagnostic", {}).get("summary", {}).get("2580")),
                (
                    "Rolling-origin birth-status candidate available"
                    if rolling.get("profetBirthStatusDiagnostic", {}).get("summary", {}).get("2580")
                    else "Awaiting first rolling-origin run"
                )
            ),
            gate(
                "Municipality→county consistency layer integrated in development engine",
                bool(rolling.get("profetConsistencyDiagnostic", {}).get("summary", {}).get("2580")),
                (
                    "With/without rolling-origin diagnostic available"
                    if rolling.get("profetConsistencyDiagnostic", {}).get("summary", {}).get("2580")
                    else "Awaiting integrated consistency run"
                )
            ),
            gate(
                "County→national consistency layer active",
                False,
                "Not active until all-county support is available."
            )
        ],
        "Keep Profet in development until birth-status and full municipality→county→national consistency gates are satisfied."
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
            f"n+1 population {birth_n1['profetBirthStatus']['populationMAE']} < {birth_n1['net10Baseline']['populationMAE']}",
            f"n+1 migration {birth_n1['profetBirthStatus']['netMigrationMAE']} < {birth_n1['net10Baseline']['netMigrationMAE']}",
            f"n+2 population {birth_n2['profetBirthStatus']['populationMAE']} <= {birth_n2['net10Baseline']['populationMAE']}",
            f"n+2 migration {birth_n2['profetBirthStatus']['netMigrationMAE']} <= {birth_n2['net10Baseline']['netMigrationMAE']}",
        ]
    birth_gate = len(birth_gate_checks) == 4 and all(birth_gate_checks)
    birth_has_rolling = bool(birth_n1 and birth_n2)
    birth_level = 3 if birth_gate else 2
    comps.append(component(
        policy, "birth_status", birth_level,
        "validated_candidate" if birth_gate else "development", False,
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
            else "Keep at level 2; do not retune birth-status parameters from these outcomes."
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
    consistency_level = (
        3 if consistency_vintage_ok
        else 2 if consistency_mass_ok
        else 1
    )
    comps.append(component(
        policy, "consistency_adjustment", consistency_level,
        "validated_candidate" if consistency_vintage_ok else "development" if consistency_mass_ok else "diagnostic", False,
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
            "Keep at level 3 and add county→national support plus an external production holdout before any level-4 promotion."
            if consistency_accuracy_ok
            else "Keep at level 3; do not tune the adjustment from these outcomes. Review the locked with/without accuracy comparison."
            if consistency_vintage_ok
            else "Complete frozen-vintage structural validation before model integration."
            if consistency_mass_ok
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
