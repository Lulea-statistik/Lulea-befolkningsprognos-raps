#!/usr/bin/env python3
"""Rolling validation of the household-size proxy used in housing demand."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"/"housing_households.json"
CONFIG=ROOT/"data"/"household_projection_config.json"
OUT=ROOT/"data"/"backtests"/"household_projection_validation.json"
FA_MEMBERS={"2580","2582","2581","2560","2514"}

def aggregate(rows, geo):
    grouped=defaultdict(lambda:{"households":0.0,"persons":0.0})
    members=FA_MEMBERS if geo=="FA_LULEA" else {geo}
    for r in rows:
        if r.get("geo") not in members:
            continue
        hh=float(r.get("households") or 0)
        pph=float(r.get("personsPerHousehold") or 0)
        if hh<=0 or pph<=0:
            continue
        y=int(r["year"])
        grouped[y]["households"]+=hh
        grouped[y]["persons"]+=hh*pph
    out=[]
    for y,g in grouped.items():
        if g["households"]>0:
            out.append({
                "year":y,
                "households":g["households"],
                "persons":g["persons"],
                "personsPerHousehold":g["persons"]/g["households"]
            })
    return sorted(out,key=lambda x:x["year"])

def trend_pph(history, future_year):
    recent=history[-5:]
    first,end=recent[0],recent[-1]
    span=max(1,end["year"]-first["year"])
    slope=(end["personsPerHousehold"]-first["personsPerHousehold"])/span
    return max(1.2,min(4.0,end["personsPerHousehold"]+slope*(future_year-end["year"])))

def mean(vals):
    return sum(vals)/len(vals) if vals else None

def main():
    data=json.loads(DATA.read_text(encoding="utf-8"))
    cfg=json.loads(CONFIG.read_text(encoding="utf-8"))
    if cfg.get("status")!="validation_gate_locked_before_results":
        raise RuntimeError("Household projection gate must be locked before results.")

    results={}
    for geo in cfg["evaluation"]["geographies"]:
        hist=aggregate(data["householdTotals"],geo)
        by_year={r["year"]:r for r in hist}
        rows=[]
        years=[r["year"] for r in hist]
        for origin in years:
            past=[r for r in hist if r["year"]<=origin]
            if len(past)<cfg["evaluation"]["minimumHistoryYears"]:
                continue
            base_pph=past[-1]["personsPerHousehold"]
            for horizon in cfg["evaluation"]["horizons"]:
                year=origin+horizon
                actual=by_year.get(year)
                if not actual:
                    continue
                constant_pred=actual["persons"]/base_pph
                tpph=trend_pph(past,year)
                trend_pred=actual["persons"]/tpph
                rows.append({
                    "origin":origin,"year":year,"horizon":horizon,
                    "actualHouseholds":actual["households"],
                    "constantPredicted":constant_pred,
                    "trendPredicted":trend_pred,
                    "constantError":constant_pred-actual["households"],
                    "trendError":trend_pred-actual["households"],
                    "originPersonsPerHousehold":base_pph,
                    "trendPersonsPerHousehold":tpph
                })
        by_h={}
        for h in cfg["evaluation"]["horizons"]:
            rr=[r for r in rows if r["horizon"]==h]
            by_h[str(h)]={
                "observations":len(rr),
                "constant":{
                    "MAE":mean([abs(r["constantError"]) for r in rr]),
                    "MAPE":mean([abs(r["constantError"])/r["actualHouseholds"]*100 for r in rr]),
                    "meanError":mean([r["constantError"] for r in rr])
                },
                "trend":{
                    "MAE":mean([abs(r["trendError"]) for r in rr]),
                    "MAPE":mean([abs(r["trendError"])/r["actualHouseholds"]*100 for r in rr]),
                    "meanError":mean([r["trendError"] for r in rr])
                }
            }
        results[geo]={"historyYears":years,"rows":rows,"byHorizon":by_h}

    checks={}
    for geo in cfg["evaluation"]["geographies"]:
        b=results[geo]["byHorizon"]
        checks[f"{geo}_n1_mae_not_worse"]=b["1"]["constant"]["MAE"]<=b["1"]["trend"]["MAE"]
        checks[f"{geo}_n2_mae_not_worse"]=b["2"]["constant"]["MAE"]<=b["2"]["trend"]["MAE"]
        checks[f"{geo}_n1_mape_le_2pct"]=b["1"]["constant"]["MAPE"]<=2.0
        checks[f"{geo}_n2_mape_le_2pct"]=b["2"]["constant"]["MAPE"]<=2.0

    out={
        "schemaVersion":"0.1.0",
        "status":"validated" if all(checks.values()) else "gate_failed",
        "allPassed":all(checks.values()),
        "checks":checks,
        "config":"data/household_projection_config.json",
        "results":results,
        "note":"Uses observed future persons to isolate the household-size assumption; this is not a full housing-market forecast backtest."
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({
        "status":out["status"],
        "checks":checks,
        "summary":{
            geo:results[geo]["byHorizon"] for geo in results
        }
    },ensure_ascii=False,indent=2))
    if not out["allPassed"]:
        print("Household projection production gate did not pass; keep component below level 4.")

if __name__=="__main__":
    main()
