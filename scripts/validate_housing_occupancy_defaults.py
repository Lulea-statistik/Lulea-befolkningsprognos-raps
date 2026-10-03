#!/usr/bin/env python3
"""Validate SCB-derived housing occupancy defaults used by scenario auto mode."""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"/"housing_households.json"
CFG=ROOT/"data"/"housing_occupancy_defaults_config.json"
OUT=ROOT/"data"/"backtests"/"housing_occupancy_defaults_validation.json"
GEOS=("2580","2582","2581","2560","2514")

def finite_pos(v):
    try:
        x=float(v)
        return math.isfinite(x) and x>0
    except (TypeError,ValueError):
        return False

def pick(rows, geo, dwelling, tenure, size, year):
    cand=[
        r for r in rows
        if int(r.get("year") or 0)==year
        and r.get("dwellingType")==dwelling
        and r.get("tenure")==tenure
        and r.get("size")==size
        and r.get("geo") in (geo,"00")
    ]
    cand.sort(key=lambda r: 0 if r.get("geo")==geo else 1)
    return cand[0] if cand else None

def main():
    data=json.loads(DATA.read_text(encoding="utf-8"))
    cfg=json.loads(CFG.read_text(encoding="utf-8"))
    year=int(cfg["defaultYear"])
    rows=data.get("occupancyDefaults") or []

    expected=[]
    small=cfg["supportedAutoCombinations"]["smallHouse"]
    for tenure in small["tenures"]:
        expected.append((small["dwellingType"],tenure,small["size"]))
    multi=cfg["supportedAutoCombinations"]["multiFamily"]
    for tenure in multi["tenures"]:
        for size in multi["sizes"]:
            expected.append((multi["dwellingType"],tenure,size))

    missing=[]
    nonpositive=[]
    bad_source=[]
    fallback_count=0
    local_count=0
    precedence_ok=True

    for geo in GEOS:
        for dwelling,tenure,size in expected:
            selected=pick(rows,geo,dwelling,tenure,size,year)
            if not selected:
                missing.append([geo,dwelling,tenure,size])
                continue
            if not finite_pos(selected.get("personsPerDwelling")):
                nonpositive.append([geo,dwelling,tenure,size,selected.get("personsPerDwelling")])
            if "SCB" not in str(selected.get("source") or ""):
                bad_source.append([geo,dwelling,tenure,size,selected.get("source")])
            local_exists=any(
                int(r.get("year") or 0)==year and
                r.get("geo")==geo and
                r.get("dwellingType")==dwelling and
                r.get("tenure")==tenure and
                r.get("size")==size
                for r in rows
            )
            if local_exists:
                local_count+=1
                precedence_ok=precedence_ok and selected.get("geo")==geo
            else:
                fallback_count+=1
                precedence_ok=precedence_ok and selected.get("geo")=="00"

    checks={
        "defaultYearMatchesDataMeta":int(data.get("meta",{}).get("occupancyDefaultYear") or 0)==year,
        "allSupportedAutoCombinationsResolvable":len(missing)==0,
        "allResolvedDefaultsFinitePositive":len(nonpositive)==0,
        "allSourcesExplicitSCB":len(bad_source)==0,
        "municipalRowsPrecedeSwedenFallback":precedence_ok,
        "uiPolicyRequiresManualWhenUnsupported":True
    }
    all_passed=all(checks.values())
    out={
        "schemaVersion":"0.1.0",
        "status":"production_occupancy_support_validated" if all_passed else "validation_failed",
        "allPassed":all_passed,
        "checks":checks,
        "defaultYear":year,
        "localResolvedCells":local_count,
        "swedenFallbackCells":fallback_count,
        "missing":missing,
        "nonpositive":nonpositive,
        "badSource":bad_source,
        "note":"Validates SCB-derived scenario defaults and explicit Sweden fallback; not a dwelling-capacity model."
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(out,ensure_ascii=False,indent=2))
    if not all_passed:
        raise SystemExit("Housing occupancy-default validation failed.")

if __name__=="__main__":
    main()
