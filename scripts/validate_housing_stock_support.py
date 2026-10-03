#!/usr/bin/env python3
"""Validate SCB housing-stock support used in the housing analysis."""
from __future__ import annotations

import json
import math
from collections import Counter, defaultdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"/"housing_households.json"
CFG=ROOT/"data"/"housing_stock_support_config.json"
OUT=ROOT/"data"/"backtests"/"housing_stock_support_validation.json"

def finite_nonnegative(v):
    try:
        x=float(v)
        return math.isfinite(x) and x>=0
    except (TypeError,ValueError):
        return False

def main():
    data=json.loads(DATA.read_text(encoding="utf-8"))
    cfg=json.loads(CFG.read_text(encoding="utf-8"))
    geos=list(cfg["geographies"])
    dtypes=list(cfg["categories"]["dwellingTypes"])
    tenures=list(cfg["categories"]["tenures"])
    year=int(data.get("meta",{}).get("latestHousingStockYear") or 0)
    rows=[
        r for r in data.get("housingStock",[])
        if r.get("geo") in geos and int(r.get("year") or 0)==year
    ]

    expected={(g,d,t) for g in geos for d in dtypes for t in tenures}
    keys=[(r["geo"],r["dwellingType"],r["tenure"]) for r in rows]
    counts=Counter(keys)
    totals=defaultdict(float)
    for r in rows:
        totals[r["geo"]]+=float(r.get("dwellings") or 0)

    checks={
        "latestYearExplicit":year>0,
        "completeCategoryGrid":set(keys)==expected,
        "noDuplicateKeys":len(keys)==len(set(keys))==len(expected),
        "allCountsFiniteNonnegative":all(finite_nonnegative(r.get("dwellings")) for r in rows),
        "allMunicipalTotalsPositive":all(totals[g]>0 for g in geos),
        "faTotalAdditive":abs(sum(totals.values())-sum(float(r.get("dwellings") or 0) for r in rows))<=1e-9
    }

    all_passed=all(checks.values())
    out={
        "schemaVersion":"0.1.0",
        "status":"production_housing_stock_validated" if all_passed else "validation_failed",
        "allPassed":all_passed,
        "checks":checks,
        "latestYear":year,
        "municipalTotals":dict(totals),
        "faTotal":sum(totals.values()),
        "duplicateKeys":[list(k) for k,v in counts.items() if v>1],
        "note":"Structural validation of descriptive SCB housing-stock support."
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(out,ensure_ascii=False,indent=2))
    if not all_passed:
        raise SystemExit("Housing-stock support validation failed.")

if __name__=="__main__":
    main()
