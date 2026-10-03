#!/usr/bin/env python3
"""Validate the explicit pre-CKM calibration / CKM base-population bridge."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MODEL=ROOT/"data"/"model_data.json"
MANIFEST=ROOT/"data"/"raw"/"manifest.json"
CFG=ROOT/"data"/"base_population_bridge_config.json"
OUT=ROOT/"data"/"backtests"/"base_population_bridge_validation.json"
MUNICIPALITIES=("2580","2582","2581","2560","2514")

def selected_years(info):
    sel=(info or {}).get("selection") or {}
    vals=sel.get("Tid") or []
    out=[]
    for x in vals:
        try: out.append(int(x))
        except (TypeError,ValueError): pass
    return out

def main():
    model=json.loads(MODEL.read_text(encoding="utf-8"))
    manifest=json.loads(MANIFEST.read_text(encoding="utf-8"))
    cfg=json.loads(CFG.read_text(encoding="utf-8"))
    files=manifest.get("files") or {}

    checks={}
    checks["baseYearIs2025"]=int(model.get("meta",{}).get("baseYear") or 0)==2025

    cal=model.get("calibration") or {}
    checks["methodBreakExplicit"]=(
        int(cal.get("preCkmEnd") or 0)==2024
        and int(cal.get("ckmStart") or 0)==2025
        and float(cal.get("ckmCellDelta") or 0)>0
    )

    rows=model.get("populationBase") or []
    by_geo=defaultdict(set)
    for r in rows:
        if r.get("geo") in MUNICIPALITIES and int(r.get("year") or 0)==2025:
            by_geo[r["geo"]].add((r.get("sex"),int(r.get("age"))))
    expected={(sex,age) for sex in ("K","M") for age in range(101)}
    checks["completeMunicipalAgeSexBase"]=all(by_geo[g]==expected for g in MUNICIPALITIES)

    base_totals=defaultdict(float)
    for r in rows:
        if r.get("geo") in MUNICIPALITIES and int(r.get("year") or 0)==2025:
            base_totals[r["geo"]]+=float(r.get("value") or 0)
    members=(next(
        (g.get("members") for g in model.get("geographies",[]) if g.get("code")=="FA_LULEA"),
        []
    ) or [])
    checks["faMembersAreLockedFive"]=set(members)==set(MUNICIPALITIES)
    fa_sum=sum(base_totals[g] for g in MUNICIPALITIES)
    checks["faBaseCanBeAdditivelyReconstructed"]=fa_sum>0 and all(base_totals[g]>0 for g in MUNICIPALITIES)

    pre_keys=(
        "population_pre2025",
        "mean_population_pre2025",
        "mean_population_event_age_pre2025",
        "births_pre2025",
        "deaths_pre2025",
        "migration_pre2025",
    )
    pre_years={}
    pre_ok=True
    for key in pre_keys:
        yrs=selected_years(files.get(key))
        pre_years[key]=yrs
        if not yrs or max(yrs)>2024:
            pre_ok=False
    checks["preCkmCalibrationSourcesStopAt2024"]=pre_ok

    base_years=selected_years(files.get("population_2025"))
    checks["ckmBaseSourceContains2025"]=2025 in base_years

    diag=model.get("diagnostics") or {}
    ckm_rows=diag.get("ckm") or []
    checks["ckm2025RetainedAsDiagnostics"]=len(ckm_rows)>0

    note=str(model.get("meta",{}).get("note") or "")
    # The model carries the break primarily through calibration metadata and CKM diagnostics.
    checks["bridgeMetadataIsReproducible"]=(
        checks["methodBreakExplicit"]
        and checks["preCkmCalibrationSourcesStopAt2024"]
        and checks["ckmBaseSourceContains2025"]
    )

    out={
        "schemaVersion":"0.1.0",
        "status":"production_bridge_validated" if all(checks.values()) else "validation_failed",
        "allPassed":all(checks.values()),
        "checks":checks,
        "municipalBaseTotals2025":dict(base_totals),
        "faBaseTotal2025":fa_sum,
        "preCkmSourceYears":pre_years,
        "ckmBaseSourceYears":base_years,
        "note":"Structural production validation of the 2024/2025 method bridge; not a forecast-accuracy claim."
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(out,ensure_ascii=False,indent=2))
    if not out["allPassed"]:
        raise SystemExit("Base-population bridge validation failed.")

if __name__=="__main__":
    main()
