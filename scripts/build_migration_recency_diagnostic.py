#!/usr/bin/env python3
"""Diagnostic-only adaptive recency test for Lulea migration."""
import json, math, statistics
from collections import defaultdict
from pathlib import Path
import build_model_data as b

ROOT=Path(__file__).resolve().parents[1]
CFG=json.loads((ROOT/"data/migration_recency_config.json").read_text(encoding="utf-8"))
BASE=json.loads((ROOT/"data/migration_component_windows.json").read_text(encoding="utf-8"))
OUT=ROOT/"data/backtests/migration_recency_diagnostic.json"
GEO="2580"

def avg(x): return statistics.fmean(x) if x else 0.0
def yrs(origin,n): return list(range(origin-n+1,origin+1))
def ev(d,y,s,a,l,q): return d.get((GEO,y,s,a,l,q),0.0)
def ex(d,y,s,a): return d.get((GEO,y,s,a),0.0)

def blend(long_v,recent_v,annual_values,annual_events):
    delta=recent_v-long_v
    sd=statistics.pstdev(annual_values) if len(annual_values)>1 else 0.0
    shift=0.0 if abs(delta)<1e-15 else (1.0 if sd<1e-15 else abs(delta)/(abs(delta)+sd))
    m=avg(annual_events); prior=float(CFG["method"]["priorAnnualEvents"])
    info=0.0 if m<=0 else m/(m+prior)
    w=max(0.0,min(1.0,shift*info))
    return long_v+w*delta,w

def ain(d,origin,s,a,l):
    ly=yrs(origin,int(CFG["method"]["longWindow"]))
    ry=yrs(origin,int(CFG["method"]["recentWindow"]))
    lv=[ev(d,y,s,a,l,"in") for y in ly]
    rv=[ev(d,y,s,a,l,"in") for y in ry]
    value,w=blend(avg(lv),avg(rv),lv,lv)
    return value,w

def aout(d,pop,origin,s,a,l):
    ly=yrs(origin,int(CFG["method"]["longWindow"]))
    ry=yrs(origin,int(CFG["method"]["recentWindow"]))
    def hz(yy):
        e=sum(ev(d,y,s,a,l,"out") for y in yy)
        p=sum(ex(pop,y,s,a) for y in yy)
        return 0.0 if p<=0 else e/p
    annual=[]; events=[]
    for y in ly:
        e=ev(d,y,s,a,l,"out"); p=ex(pop,y,s,a)
        events.append(e); annual.append(0.0 if p<=0 else e/p)
    value,w=blend(hz(ly),hz(ry),annual,events)
    return value,w

def bin_(d,origin,s,a,l,n):
    return avg([ev(d,y,s,a,l,"in") for y in yrs(origin,n)])

def bout(d,pop,origin,s,a,l,n):
    yy=yrs(origin,n)
    e=sum(ev(d,y,s,a,l,"out") for y in yy)
    p=sum(ex(pop,y,s,a) for y in yy)
    return 0.0 if p<=0 else e/p

def rec(d,pop,origin,h,l,q):
    target=origin+h
    n=int(BASE["legs"][l]["inflowWindow" if q=="in" else "outflowWindow"])
    actual=bp=ap=bsae=asae=ws=0.0; cells=0
    for s in ("K","M"):
        for a in range(101):
            act=ev(d,target,s,a,l,q)
            if q=="in":
                bpred=bin_(d,origin,s,a,l,n); apred,w=ain(d,origin,s,a,l)
            else:
                tx=ex(pop,target,s,a)
                bpred=bout(d,pop,origin,s,a,l,n)*tx
                ah,w=aout(d,pop,origin,s,a,l); apred=ah*tx
            actual+=act; bp+=bpred; ap+=apred
            bsae+=abs(bpred-act); asae+=abs(apred-act); ws+=w; cells+=1
    return dict(origin=origin,horizon=h,year=target,leg=l,label=b.MIGRATION_LEG_LABELS[l],
                direction=q,baselineWindow=n,actual=actual,baselinePredicted=bp,
                adaptivePredicted=ap,baselineAbsoluteError=abs(bp-actual),
                adaptiveAbsoluteError=abs(ap-actual),baselineAgeSexSAE=bsae,
                adaptiveAgeSexSAE=asae,meanAdaptiveWeight=ws/cells)

def summary(rows):
    g=defaultdict(list)
    for r in rows: g[(r["sample"],r["leg"],r["direction"],r["horizon"])].append(r)
    out=[]
    for (sample,l,q,h),rr in sorted(g.items()):
        bm=avg([x["baselineAbsoluteError"] for x in rr]); am=avg([x["adaptiveAbsoluteError"] for x in rr])
        bs=avg([x["baselineAgeSexSAE"] for x in rr]); ass=avg([x["adaptiveAgeSexSAE"] for x in rr])
        out.append(dict(sample=sample,leg=l,label=b.MIGRATION_LEG_LABELS[l],direction=q,horizon=h,
                        observations=len(rr),baselineMAE=bm,adaptiveMAE=am,
                        maeImprovementPct=None if bm<=0 else 100*(bm-am)/bm,
                        baselineMeanAgeSexSAE=bs,adaptiveMeanAgeSexSAE=ass,
                        ageSexSAEImprovementPct=None if bs<=0 else 100*(bs-ass)/bs,
                        meanAdaptiveWeight=avg([x["meanAdaptiveWeight"] for x in rr])))
    return out

def cohort(d,pop):
    spec=CFG["evaluation"]["knownCohortCase"]; cohort=int(spec["cohort"]); rows=[]
    for origin in spec["origins"]:
        target=origin+1; age=target-cohort
        actnet=base=adapt=net10=0.0; legs=[]
        for l in b.MIGRATION_LEG_LABELS:
            ai=ao=bi=bo=adi=ado=0.0
            for s in ("K","M"):
                tx=ex(pop,target,s,age)
                ai+=ev(d,target,s,age,l,"in"); ao+=ev(d,target,s,age,l,"out")
                bi+=bin_(d,origin,s,age,l,int(BASE["legs"][l]["inflowWindow"]))
                bo+=bout(d,pop,origin,s,age,l,int(BASE["legs"][l]["outflowWindow"]))*tx
                adi+=ain(d,origin,s,age,l)[0]; ado+=aout(d,pop,origin,s,age,l)[0]*tx
                net10+=avg([ev(d,y,s,age,l,"in")-ev(d,y,s,age,l,"out") for y in yrs(origin,10)])
            an=ai-ao; bn=bi-bo; adn=adi-ado
            actnet+=an; base+=bn; adapt+=adn
            legs.append(dict(leg=l,label=b.MIGRATION_LEG_LABELS[l],actualNet=an,
                             baselineNet=bn,adaptiveNet=adn,
                             baselineNetError=bn-an,adaptiveNetError=adn-an))
        rows.append(dict(cohort=cohort,origin=origin,year=target,age=age,actualNetMigration=actnet,
                         productionNet10Predicted=net10,productionNet10Error=net10-actnet,
                         lockedComponentPredicted=base,lockedComponentError=base-actnet,
                         adaptiveComponentPredicted=adapt,adaptiveComponentError=adapt-actnet,legs=legs))
    return dict(note=spec["note"],rows=rows,cumulative={
        "actualNetMigration":sum(x["actualNetMigration"] for x in rows),
        "productionNet10Error":sum(x["productionNet10Error"] for x in rows),
        "lockedComponentError":sum(x["lockedComponentError"] for x in rows),
        "adaptiveComponentError":sum(x["adaptiveComponentError"] for x in rows)})

def clean(x):
    if isinstance(x,dict): return {k:clean(v) for k,v in x.items()}
    if isinstance(x,list): return [clean(v) for v in x]
    if isinstance(x,float): return None if not math.isfinite(x) else round(x,4)
    return x

def main():
    if CFG.get("status")!="development_diagnostic_locked_before_results":
        raise RuntimeError("Unexpected recency config status")
    d=b.load_migration_legs("migration_birth_region_pre2025.csv",b.MIGRATION_LEG_CODES_PRE2025,allowed_geos={GEO})
    pop=b.load_wide_age_sex(b.HISTORICAL_BIRTH_YEAR_EXPOSURE_FILE,allowed_geos={GEO})
    dev=set(CFG["evaluation"]["developmentOrigins"]); later=set(CFG["evaluation"]["laterDiagnosticOrigins"])
    rows=[]
    for origin in sorted(dev|later):
        for h in CFG["evaluation"]["horizons"]:
            for l in b.MIGRATION_LEG_LABELS:
                for q in ("in","out"):
                    r=rec(d,pop,origin,int(h),l,q); r["sample"]="development" if origin in dev else "later_diagnostic"; rows.append(r)
    report={"schemaVersion":"0.1.0","status":CFG["status"],"productionDefault":False,
            "selectionIndependent":False,"geo":GEO,"config":CFG,"baselineConfig":BASE["legs"],
            "methodNote":"Outflow diagnostic uses observed target-year exposure only to isolate hazard calibration; it is not a full forecast score.",
            "records":rows,"summary":summary(rows),"knownCohort1999":cohort(d,pop)}
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(clean(report),ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"Wrote {OUT.relative_to(ROOT)}")
    for r in report["summary"]:
        print(f"{r['sample']} {r['label']} {r['direction']} n+{r['horizon']}: total MAE {r['maeImprovementPct']:.1f}% | age/sex SAE {r['ageSexSAEImprovementPct']:.1f}%")

if __name__=="__main__": main()
