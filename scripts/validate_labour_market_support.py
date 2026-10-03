#!/usr/bin/env python3
"""Validate labour-market/commuting support data used by scenarios."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"/"labour_market.json"
CFG=ROOT/"data"/"labour_market_support_config.json"
OUT=ROOT/"data"/"backtests"/"labour_market_support_validation.json"

def main():
    data=json.loads(DATA.read_text(encoding="utf-8"))
    cfg=json.loads(CFG.read_text(encoding="utf-8"))
    if cfg.get("status")!="validation_gate_locked_before_results":
        raise RuntimeError("Labour support validation gate must be locked before results.")

    geos=set(cfg["requiredGeographies"])
    years=set(int(y) for y in cfg["requiredYears"])
    tol=float(cfg.get("tolerancePct",1e-6))

    checks={}
    checks["allRequiredGeographiesPresent"]=geos.issubset(
        {g["code"] for g in data.get("geographies",[])}
    )

    series=defaultdict(set)
    for r in data.get("workplaceSeries",[]):
        if r.get("workplace") in geos:
            series[r["workplace"]].add(int(r["year"]))
    checks["allWorkplacesCoverRequiredYears"]=all(
        years.issubset(series[g]) for g in geos
    )

    shares=defaultdict(float)
    for r in data.get("residenceShares",[]):
        key=(r.get("workplace"),int(r.get("year")))
        if key[0] in geos:
            shares[key]+=float(r.get("sharePct") or 0)
    share_residuals={
        f"{w}_{y}":abs(v-100.0) for (w,y),v in shares.items()
        if w in geos and y in years
    }
    checks["residenceSharesSumTo100"]=(
        len(share_residuals)==len(geos)*len(years)
        and max(share_residuals.values(),default=999)<=tol
    )

    latest=int(data.get("meta",{}).get("latestYear") or max(years))
    matrix=defaultdict(float)
    for r in data.get("matrixLatest",[]):
        if r.get("workplace") in geos and int(r.get("year"))==latest:
            matrix[r["workplace"]]+=float(r.get("value") or 0)
    summary={
        r["workplace"]:float(r.get("jobs") or 0)
        for r in data.get("workplaceSummary",[])
        if r.get("workplace") in geos and int(r.get("year"))==latest
    }
    matrix_residuals={
        g:abs(matrix.get(g,0)-summary.get(g,0)) for g in geos
    }
    checks["latestMatrixReconcilesToWorkplaceTotals"]=(
        set(summary)==geos and max(matrix_residuals.values(),default=999)<=1e-9
    )

    expected_cells={(sex,a,b) for sex in ("K","M") for a,b in ((15,24),(25,54),(55,74))}
    cells=defaultdict(set)
    age_share=defaultdict(float)
    age_years_ok=True
    for r in data.get("workerAgeGroups",[]):
        g=r.get("workplace")
        if g not in geos:
            continue
        cells[g].add((r.get("sex"),int(r.get("ageMin")),int(r.get("ageMax"))))
        age_share[g]+=float(r.get("sharePct") or 0)
        age_years_ok=age_years_ok and set(map(int,r.get("years") or []))=={2022,2023,2024}
    checks["workerAgeCellsComplete"]=all(cells[g]==expected_cells for g in geos)
    checks["workerAgeSharesSumTo100"]=all(abs(age_share[g]-100.0)<=tol for g in geos)
    checks["workerAgeProfileUsesLockedYears2022to2024"]=age_years_ok

    q=str(data.get("meta",{}).get("qualityNote") or "").lower()
    checks["qualityMethodBreakExplicit"]=("2024" in q and ("entrepren" in q or "företag" in q or "classif" in q))

    out={
        "schemaVersion":"0.1.0",
        "status":"validated_support_layer" if all(checks.values()) else "validation_failed",
        "allPassed":all(checks.values()),
        "checks":checks,
        "shareResidualsPct":share_residuals,
        "matrixResiduals":matrix_residuals,
        "workerAgeShareTotals":dict(age_share),
        "note":"Structural/reproducibility validation of SCB labour support data; not a causal migration validation."
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(out,ensure_ascii=False,indent=2))
    if not out["allPassed"]:
        raise SystemExit("Labour-market support validation failed.")

if __name__=="__main__":
    main()
