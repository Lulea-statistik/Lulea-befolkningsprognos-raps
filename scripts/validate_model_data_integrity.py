#!/usr/bin/env python3
"""Validate structural integrity of core production model arrays."""
from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MODEL=ROOT/"data"/"model_data.json"
CFG=ROOT/"data"/"model_data_integrity_config.json"
OUT=ROOT/"data"/"backtests"/"model_data_integrity_validation.json"

def finite(value):
    try:
        return math.isfinite(float(value))
    except (TypeError,ValueError):
        return False

def main():
    data=json.loads(MODEL.read_text(encoding="utf-8"))
    cfg=json.loads(CFG.read_text(encoding="utf-8"))
    geos=list(cfg["geographies"])
    windows=[int(x) for x in cfg["windows"]]
    checks={}

    # Base population: exactly one municipal cell per sex x age.
    base=[
        r for r in data.get("populationBase",[])
        if r.get("geo") in geos and int(r.get("year") or 0)==2025
    ]
    base_keys=[(r["geo"],r["sex"],int(r["age"])) for r in base]
    base_expected={(g,s,a) for g in geos for s in ("K","M") for a in range(101)}
    checks["basePopulationComplete"]=set(base_keys)==base_expected
    checks["basePopulationNoDuplicateKeys"]=len(base_keys)==len(set(base_keys))==len(base_expected)
    checks["basePopulationFiniteNonnegative"]=all(
        finite(r.get("value")) and float(r.get("value"))>=0 for r in base
    )

    # Historical/local production profiles are the rows without a future year.
    fert=[
        r for r in data.get("fertilityRates",[])
        if r.get("geo") in geos and r.get("year") is None and int(r.get("window")) in windows
    ]
    fert_keys=[(r["geo"],int(r["window"]),int(r["age"])) for r in fert]
    fert_expected={(g,w,a) for g in geos for w in windows for a in range(15,50)}
    checks["fertilityProfilesComplete"]=set(fert_keys)==fert_expected
    checks["fertilityProfilesNoDuplicateKeys"]=len(fert_keys)==len(set(fert_keys))==len(fert_expected)
    checks["fertilityValuesFiniteNonnegative"]=all(
        finite(r.get("value")) and float(r.get("value"))>=0 for r in fert
    )

    mort=[
        r for r in data.get("mortalityRisks",[])
        if r.get("geo") in geos and r.get("year") is None and int(r.get("window")) in windows
    ]
    mort_keys=[
        (r["geo"],int(r["window"]),r["sex"],int(r["age"])) for r in mort
    ]
    mort_expected={
        (g,w,s,a)
        for g in geos for w in windows for s in ("K","M") for a in range(101)
    }
    checks["mortalityProfilesComplete"]=set(mort_keys)==mort_expected
    checks["mortalityProfilesNoDuplicateKeys"]=len(mort_keys)==len(set(mort_keys))==len(mort_expected)
    checks["mortalityValuesFiniteInUnitInterval"]=all(
        finite(r.get("value")) and 0<=float(r.get("value"))<=1 for r in mort
    )

    mig=[
        r for r in data.get("netMigration",[])
        if r.get("geo") in geos and r.get("year")=="BASE" and int(r.get("window")) in windows
    ]
    mig_keys=[
        (r["geo"],int(r["window"]),r["sex"],int(r["age"])) for r in mig
    ]
    mig_expected={
        (g,w,s,a)
        for g in geos for w in windows for s in ("K","M") for a in range(101)
    }
    checks["netMigrationProfilesComplete"]=set(mig_keys)==mig_expected
    checks["netMigrationProfilesNoDuplicateKeys"]=len(mig_keys)==len(set(mig_keys))==len(mig_expected)
    checks["netMigrationValuesFinite"]=all(finite(r.get("value")) for r in mig)

    fa=next((g for g in data.get("geographies",[]) if g.get("code")=="FA_LULEA"),{})
    checks["faMembershipExact"]=set(fa.get("members") or [])==set(geos)

    checks["calibrationWindowsExact"]=set(map(int,data.get("calibration",{}).get("options") or []))==set(windows)
    checks["defaultWindowIs10"]=int(data.get("calibration",{}).get("defaultYears") or 0)==10
    checks["dataReadyFlag"]=data.get("meta",{}).get("dataReady") is True

    all_passed=all(checks.values())
    out={
        "schemaVersion":"0.1.0",
        "status":"production_data_integrity_validated" if all_passed else "validation_failed",
        "allPassed":all_passed,
        "checks":checks,
        "counts":{
            "basePopulation":len(base),
            "fertilityBaseProfiles":len(fert),
            "mortalityBaseProfiles":len(mort),
            "netMigrationBaseProfiles":len(mig)
        },
        "note":"Structural completeness/uniqueness/numeric integrity gate; not a forecast-accuracy claim."
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(out,ensure_ascii=False,indent=2))
    if not all_passed:
        raise SystemExit("Model data integrity validation failed.")

if __name__=="__main__":
    main()
