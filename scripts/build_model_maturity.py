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
OUT_JSON = ROOT / "data" / "model_maturity.json"
OUT_JS = ROOT / "data" / "model_maturity.js"

WINDOWS = ("3", "6", "10")
GEOS = ("2580", "FA_LULEA")


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def gate(label, passed, evidence):
    return {"label": label, "passed": bool(passed), "evidence": evidence}


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

    # Smoothing remains diagnostic.
    comps.append(component(
        policy, "migration_age_smoothing", 1, "diagnostic", False,
        [gate(
            "Diagnostic data generated",
            smoothing.get("status") == "diagnostic_only_not_active_in_forecast"
            and len(smoothing.get("allAgeDirectionRows", [])) > 0,
            f"status={smoothing.get('status')}; rows={len(smoothing.get('allAgeDirectionRows', []))}"
        )],
        "Add vintage-correct rolling-origin score with smoothing on/off before any promotion."
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
            gate("County/national consistency adjustment active", False, profet_cfg["consistencyAdjustment"]["currentModelStatus"])
        ],
        "Implement Profet incrementally: direct risk structure, then birth status, then consistency adjustment."
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

    comps.append(component(
        policy, "consistency_adjustment", 1, "diagnostic", False,
        [gate(
            "Municipality-county consistency diagnostic exists",
            (ROOT / "data" / "backtests" / "scb_consistency_diagnostic.json").exists(),
            "Diagnostic exists; adjustment algorithm is not active."
        )],
        "Build a mass-preserving municipality→county adjustment and validate it on historical vintages."
    ))

    industrial_cfg = load(ROOT / "data" / "industrial_workforce_scenario_config.json")
    comps.append(component(
        policy, "industrial_workforce_scenario", 2, "development_scenario", False,
        [
            gate("Scenario is explicitly excluded from baseline", industrial_cfg.get("baselineExcluded") is True, "baselineExcluded=true"),
            gate("International recruitment share is explicit", "internationalRecruitmentSharePct" in industrial_cfg.get("fields", {}), "Explicit Sweden/international split is available")
        ],
        "Add documented scenario presets/ranges for Boden; do not hard-code a Skellefteå percentage."
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
