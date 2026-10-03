#!/usr/bin/env python3
"""Audit the production fading policy and downstream rolling evidence."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
import build_model_data as b

CFG=ROOT/"data"/"fading_policy_config.json"
ROLLING=ROOT/"data"/"backtests"/"rolling_2018_2024.json"
OUT=ROOT/"data"/"backtests"/"fading_policy_validation.json"
GEOS=("2580","FA_LULEA")
WINDOWS=(3,6,10)

def main():
    cfg=json.loads(CFG.read_text(encoding="utf-8"))
    rolling=json.loads(ROLLING.read_text(encoding="utf-8"))
    t=cfg["thresholds"]
    checks={}

    checks["thresholdsMatchProductionBuilder"]=(
        float(t["zeroLocalExposure"])==float(b.FADING_ZERO_LOCAL_EXPOSURE)
        and float(t["fullLocalExposure"])==float(b.FADING_FULL_LOCAL_EXPOSURE)
        and float(t["zeroExpectedEvents"])==float(b.FADING_ZERO_EXPECTED_EVENTS)
        and float(t["fullExpectedEvents"])==float(b.FADING_FULL_EXPECTED_EVENTS)
    )

    checks["zeroInformationYieldsZeroWeight"]=(
        b.fallback_fading_weight(0,20)==0
        and b.fallback_fading_weight(20,20)==0
        and b.fallback_fading_weight(150,0.5)==0
    )
    checks["strongInformationCanBeFullyLocal"]=(
        abs(b.fallback_fading_weight(100,20)-1.0)<1e-12
        and abs(b.fallback_fading_weight(1000,200)-1.0)<1e-12
    )

    exp=[b.fallback_fading_weight(x,20) for x in range(0,121)]
    evt=[b.fallback_fading_weight(100,x) for x in range(0,31)]
    checks["monotonicInExposure"]=all(exp[i]<=exp[i+1]+1e-15 for i in range(len(exp)-1))
    checks["monotonicInExpectedEvents"]=all(evt[i]<=evt[i+1]+1e-15 for i in range(len(evt)-1))
    checks["deterministicOutcomeIndependent"]=(
        b.fallback_fading_weight(55,8)==b.fallback_fading_weight(55,8)
    )

    fert=rolling.get("fertilityLocalizationDiagnostic",{}).get("summary",{})
    fert_ok=True
    fert_evidence={}
    for geo in GEOS:
        fert_evidence[geo]={}
        for w in WINDOWS:
            r=(fert.get(geo,{}) or {}).get(str(w)) or (fert.get(geo,{}) or {}).get(w)
            ok=bool(r) and r["localizedBirthsMAE"]<r["nationalOnlyBirthsMAE"]
            fert_ok=fert_ok and ok
            fert_evidence[geo][str(w)]={
                "passed":ok,
                "localizedMAE":None if not r else r["localizedBirthsMAE"],
                "nationalOnlyMAE":None if not r else r["nationalOnlyBirthsMAE"]
            }
    checks["fertilityLocalizationRollingGateStillPasses"]=fert_ok

    mort=rolling.get("mortalityLocalizationDiagnostic",{}).get("summary",{})
    mort_ok=True
    mort_evidence={}
    for geo in GEOS:
        mort_evidence[geo]={}
        for w in WINDOWS:
            r=(mort.get(geo,{}) or {}).get(str(w)) or (mort.get(geo,{}) or {}).get(w)
            ok=bool(r) and r["localizedDeathsMAE"]<r["nationalOnlyDeathsMAE"]
            mort_ok=mort_ok and ok
            mort_evidence[geo][str(w)]={
                "passed":ok,
                "localizedMAE":None if not r else r["localizedDeathsMAE"],
                "nationalOnlyMAE":None if not r else r["nationalOnlyDeathsMAE"]
            }
    checks["mortalityLocalizationRollingGateStillPasses"]=mort_ok

    out={
        "schemaVersion":"0.1.0",
        "status":"production_policy_validated" if all(checks.values()) else "validation_failed",
        "allPassed":all(checks.values()),
        "checks":checks,
        "thresholds":t,
        "fertilityEvidence":fert_evidence,
        "mortalityEvidence":mort_evidence,
        "note":"Audit of the existing production fallback policy. No threshold is estimated from these outcomes."
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(out,ensure_ascii=False,indent=2))
    if not out["allPassed"]:
        raise SystemExit("Fading policy validation failed.")

if __name__=="__main__":
    main()
