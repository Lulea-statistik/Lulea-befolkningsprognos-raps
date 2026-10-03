#!/usr/bin/env python3
"""Independent external validation of the pre-declared five-year household trend."""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import build_housing_households as h

ROOT=Path(__file__).resolve().parents[1]
CFG=ROOT/"data"/"household_projection_external_config.json"
MANIFEST=ROOT/"data"/"raw"/"manifest.json"
OUT=ROOT/"data"/"backtests"/"household_projection_external_validation.json"

def rows_for_geos(geos):
    manifest=h.load_manifest()
    key="household_totals"
    rows=list(h.read_rows(key))
    if not rows:
        return []
    region_dim=h.dimension_id(manifest,key,["region"]) or "Region"
    cols=h.content_columns(manifest,key,rows[0].keys())
    out=[]
    for r in rows:
        geo=r.get(region_dim)
        if geo not in geos:
            continue
        by_year=defaultdict(dict)
        for col,_,year,label in cols:
            val=h.number(r.get(col))
            if val is None:
                continue
            nlabel=h.norm(label)
            if nlabel.startswith("antal hushall"):
                by_year[year]["households"]=val
            elif "personer per hushall" in nlabel:
                by_year[year]["personsPerHousehold"]=val
        for year,vals in by_year.items():
            hh=vals.get("households")
            pph=vals.get("personsPerHousehold")
            if hh and pph:
                out.append({
                    "geo":geo,"year":year,"households":hh,
                    "personsPerHousehold":pph,"persons":hh*pph
                })
    return sorted(out,key=lambda r:(r["geo"],r["year"]))

def trend_pph(history,year):
    recent=history[-5:]
    first,end=recent[0],recent[-1]
    span=max(1,end["year"]-first["year"])
    slope=(end["personsPerHousehold"]-first["personsPerHousehold"])/span
    return max(1.2,min(4.0,end["personsPerHousehold"]+slope*(year-end["year"])))

def mean(vals):
    return sum(vals)/len(vals) if vals else None

def metrics(rows,prefix):
    if not rows:
        return {"observations":0,"MAE":None,"MAPE":None,"meanError":None}
    errs=[r[prefix+"Error"] for r in rows]
    return {
        "observations":len(rows),
        "MAE":mean([abs(v) for v in errs]),
        "MAPE":mean([abs(r[prefix+"Error"])/r["actualHouseholds"]*100 for r in rows]),
        "meanError":mean(errs)
    }

def main():
    cfg=json.loads(CFG.read_text(encoding="utf-8"))
    if cfg.get("status")!="external_holdouts_locked_before_results":
        raise RuntimeError("External household holdouts must be locked before results.")

    holdouts=cfg["holdouts"]
    raw=rows_for_geos(set(holdouts))
    present={r["geo"] for r in raw}
    missing=[g for g in holdouts if g not in present]
    if missing:
        out={
            "schemaVersion":"0.1.0",
            "status":"awaiting_full_scb_refresh",
            "allPassed":False,
            "missingGeographies":missing,
            "note":"Run Update SCB data in full mode so locked external household holdouts are downloaded."
        }
        OUT.parent.mkdir(parents=True,exist_ok=True)
        OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print(json.dumps(out,ensure_ascii=False,indent=2))
        return

    detail={}
    pooled=defaultdict(list)
    wins={"1":0,"2":0}
    for geo,name in holdouts.items():
        hist=sorted([r for r in raw if r["geo"]==geo],key=lambda r:r["year"])
        by_year={r["year"]:r for r in hist}
        scored=[]
        for origin_row in hist:
            origin=origin_row["year"]
            past=[r for r in hist if r["year"]<=origin]
            if len(past)<5:
                continue
            base_pph=past[-1]["personsPerHousehold"]
            for horizon in (1,2,3):
                actual=by_year.get(origin+horizon)
                if not actual:
                    continue
                const_pred=actual["persons"]/base_pph
                trend_pred=actual["persons"]/trend_pph(past,actual["year"])
                row={
                    "origin":origin,"year":actual["year"],"horizon":horizon,
                    "actualHouseholds":actual["households"],
                    "constantError":const_pred-actual["households"],
                    "trendError":trend_pred-actual["households"]
                }
                scored.append(row)
                pooled[str(horizon)].append({**row,"geo":geo})
        by_h={}
        for horizon in (1,2,3):
            rr=[r for r in scored if r["horizon"]==horizon]
            by_h[str(horizon)]={
                "constant":metrics(rr,"constant"),
                "trend":metrics(rr,"trend")
            }
        for horizon in ("1","2"):
            if by_h[horizon]["trend"]["MAE"] < by_h[horizon]["constant"]["MAE"]:
                wins[horizon]+=1
        detail[geo]={"name":name,"byHorizon":by_h}

    pooled_metrics={}
    for horizon in ("1","2","3"):
        rr=pooled[horizon]
        pooled_metrics[horizon]={
            "constant":metrics(rr,"constant"),
            "trend":metrics(rr,"trend")
        }

    p1,p2=pooled_metrics["1"],pooled_metrics["2"]
    checks={
        "pooled_n1_trend_mae_below_constant":p1["trend"]["MAE"]<p1["constant"]["MAE"],
        "pooled_n2_trend_mae_below_constant":p2["trend"]["MAE"]<p2["constant"]["MAE"],
        "pooled_n1_trend_mape_le_2pct":p1["trend"]["MAPE"]<=2.0,
        "pooled_n2_trend_mape_le_2pct":p2["trend"]["MAPE"]<=2.0,
        "n1_at_least_4_of_5_holdouts_win":wins["1"]>=4,
        "n2_at_least_4_of_5_holdouts_win":wins["2"]>=4
    }
    out={
        "schemaVersion":"0.1.0",
        "status":"passed_external_gate" if all(checks.values()) else "failed_external_gate",
        "allPassed":all(checks.values()),
        "checks":checks,
        "wins":wins,
        "pooled":pooled_metrics,
        "holdouts":detail,
        "config":"data/household_projection_external_config.json",
        "note":"External control of household-size projection only; not a housing-market forecast."
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({
        "status":out["status"],"checks":checks,"wins":wins,"pooled":pooled_metrics
    },ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
