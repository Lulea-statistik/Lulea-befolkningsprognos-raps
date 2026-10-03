#!/usr/bin/env python3
"""Validate industrial workforce scenario presets and governance.

This is structural scenario validation. It verifies reproducibility, bounded
parameters and monotonic sensitivity settings. It does not claim that any
preset is a forecast of future employment or migration.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "data" / "industrial_workforce_scenario_config.json"
OUT = ROOT / "data" / "backtests" / "industrial_workforce_scenario_validation.json"

ORDERED_FIELDS = (
    "realizationPct",
    "moveSharePct",
    "personsPerJob",
    "internationalRecruitmentSharePct",
)
INVERSE_ORDERED_FIELDS = ("phaseYears",)


def in_range(value, bounds):
    lo, hi = bounds
    return lo <= value <= hi


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    presets = cfg.get("sensitivityPresets") or {}
    ranges = cfg.get("parameterRanges") or {}
    required_presets = ("low", "reference", "high")

    checks = {}

    checks["baselineExcluded"] = cfg.get("baselineExcluded") is True
    checks["threePresetsPresent"] = all(k in presets for k in required_presets)
    checks["jobScaleDocumented"] = (
        (cfg.get("bodenReferenceJobs") or {}).get("initialPlantJobs") == 1500
        and (cfg.get("bodenReferenceJobs") or {}).get("longerTermPlantJobs") == 2000
    )

    bounded = True
    for key in required_presets:
        preset = presets.get(key) or {}
        for field, info in ranges.items():
            if field not in preset or not in_range(float(preset[field]), info["range"]):
                bounded = False
    checks["allPresetValuesWithinDocumentedRanges"] = bounded

    monotonic = True
    for field in ORDERED_FIELDS:
        vals = [float(presets[k][field]) for k in required_presets]
        monotonic = monotonic and vals[0] <= vals[1] <= vals[2]
    for field in INVERSE_ORDERED_FIELDS:
        vals = [float(presets[k][field]) for k in required_presets]
        monotonic = monotonic and vals[0] >= vals[1] >= vals[2]
    checks["sensitivityOrderingMonotonic"] = monotonic

    mechanics = all(
        presets[k].get("allocationMode") == "commuting"
        and presets[k].get("ageProfileMode") == "worker_household"
        for k in required_presets
    )
    checks["presetsUseObservedCommutingAndWorkerHouseholdMechanics"] = mechanics

    governance_text = " ".join(cfg.get("presetGovernance") or []).lower()
    checks["presetsExplicitlyNotForecasts"] = (
        "not forecasts" in governance_text
        or "not forecast" in governance_text
    )
    checks["jobCountAndYearRemainExplicitInputs"] = (
        "job count" in governance_text and "start year" in governance_text
    )

    result = {
        "schemaVersion": "0.1.0",
        "status": "validated_scenario_structure" if all(checks.values()) else "validation_failed",
        "allPassed": all(checks.values()),
        "checks": checks,
        "presets": presets,
        "parameterRanges": ranges,
        "note": (
            "Structural scenario validation only. Passing means the scenario is "
            "transparent, bounded and reproducible; it does not establish a most-likely "
            "industrial development outcome."
        ),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(json.dumps(checks, ensure_ascii=False))
    if not result["allPassed"]:
        raise SystemExit("Industrial workforce scenario validation failed.")


if __name__ == "__main__":
    main()
