#!/usr/bin/env python3
"""Validate scenario migration age/sex profiles used by workplace scenarios."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MODEL=ROOT/"data"/"model_data.json"
LABOUR=ROOT/"data"/"labour_market.json"
CFG=ROOT/"data"/"scenario_migration_profiles_config.json"
OUT=ROOT/"data"/"backtests"/"scenario_migration_profiles_validation.json"

def main():
    model=json.loads(MODEL.read_text(encoding="utf-8"))
    labour=json.loads(LABOUR.read_text(encoding="utf-8"))
    cfg=json.loads(CFG.read_text(encoding="utf-8"))
    rows=model.get("scenarioMigrationProfiles") or []
    geos=cfg["requiredGeographies"]
    windows=[int(x) for x in cfg["windows"]]
    profiles=list(cfg["profiles"].keys())

    checks={}

    totals=defaultdict(float)
    nonnegative=True
    for r in rows:
        if r.get("geo") in geos and int(r.get("window")) in windows and r.get("profile") in profiles:
            v=float(r.get("share") or 0)
            nonnegative=nonnegative and v>=0 and v==v
            totals[(r["geo"],int(r["window"]),r["profile"])]+=v

    expected={(g,w,p) for g in geos for w in windows for p in profiles}
    checks["allProfilesPresent"]=expected.issubset(set(totals))
    checks["allProfilesSumToOne"]=all(
        abs(totals[k]-1.0)<=1e-9 for k in expected
    )
    checks["allSharesFiniteNonnegative"]=nonnegative

    worker_outside=0.0
    companion_18_24=0.0
    for r in rows:
        if r.get("geo") not in geos or int(r.get("window")) not in windows:
            continue
        age=int(r.get("age"))
        v=float(r.get("share") or 0)
        if r.get("profile")=="worker_hybrid" and not (15<=age<=74):
            worker_outside+=v
        if r.get("profile")=="family_companion" and 18<=age<=24:
            companion_18_24+=v
    checks["workerHybridZeroOutside15to74"]=abs(worker_outside)<=1e-12
    checks["familyCompanionZeroAge18to24"]=abs(companion_18_24)<=1e-12

    # Reconcile broad age/sex worker structure to the SCB TAB3205-derived
    # workerAgeGroups already validated in labour_market_support.
    target=defaultdict(float)
    for r in labour.get("workerAgeGroups",[]):
        g=r.get("workplace")
        if g not in geos:
            continue
        target[(g,r["sex"],int(r["ageMin"]),int(r["ageMax"]))]=float(r.get("sharePct") or 0)/100.0

    worker_ok=True
    worker_residuals={}
    groups=((15,24),(25,54),(55,74))
    for g in geos:
        for w in windows:
            rr=[r for r in rows if r.get("geo")==g and int(r.get("window"))==w and r.get("profile")=="worker_hybrid"]
            for sex in ("K","M"):
                for amin,amax in groups:
                    actual=sum(float(r.get("share") or 0) for r in rr if r.get("sex")==sex and amin<=int(r.get("age"))<=amax)
                    expected_share=target.get((g,sex,amin,amax),0.0)
                    res=abs(actual-expected_share)
                    worker_residuals[f"{g}_{w}_{sex}_{amin}_{amax}"]=res
                    worker_ok=worker_ok and res<=1e-9
    checks["workerHybridReconcilesToLabourTargets"]=worker_ok

    # Baseline simulation must not depend on the presence of scenario profiles.
    # Structural proxy: profiles are stored in a dedicated scenario-only array
    # and ordinary production net migration remains in netMigration.
    checks["scenarioProfilesSeparatedFromBaselineMigration"]=(
        bool(model.get("netMigration"))
        and isinstance(model.get("scenarioMigrationProfiles"),list)
        and model.get("parameters",{}).get("scenarioMigrationProfileMethod") is not None
    )

    out={
        "schemaVersion":"0.1.0",
        "status":"production_scenario_profiles_validated" if all(checks.values()) else "validation_failed",
        "allPassed":all(checks.values()),
        "checks":checks,
        "workerTargetResiduals":worker_residuals,
        "note":"Structural validation of descriptive scenario priors; not a causal validation of job-induced migration."
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(out,ensure_ascii=False,indent=2))
    if not out["allPassed"]:
        raise SystemExit("Scenario migration profile validation failed.")

if __name__=="__main__":
    main()
