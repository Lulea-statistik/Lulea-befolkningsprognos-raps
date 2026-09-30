(function(global){
  "use strict";
  const MAX_AGE = 100;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const key=(sex,age)=>`${sex}|${age}`;
  const n=(x)=>Number.isFinite(+x)?+x:0;

  function riskFromEvents(events, exposure){
    events=n(events); exposure=n(exposure);
    if(exposure<=0 || events<=0) return 0;
    return clamp(1-Math.exp(-events/exposure),0,1);
  }
  function ckmMaxRelativePct(value, delta=3){
    value=Math.abs(n(value));
    return value>0 ? 100*delta/value : null;
  }
  function ckmRiskBounds(events, exposure, delta=3){
    const lowE=Math.max(0,n(events)-delta), highE=Math.max(0,n(events)+delta);
    const lowP=Math.max(1,n(exposure)-delta), highP=Math.max(1,n(exposure)+delta);
    return {
      low:riskFromEvents(lowE,highP),
      base:riskFromEvents(events,exposure),
      high:riskFromEvents(highE,lowP)
    };
  }
  function identityTransition(size){
    return Array.from({length:size},(_,r)=>Array.from({length:size},(_,c)=>r===c?1:0));
  }
  function selectWindow(records,endYear,years){
    const start=endYear-years+1;
    return records.filter(r=>+r.year>=start && +r.year<=endYear);
  }
  function mean(values){
    const a=values.map(Number).filter(Number.isFinite);
    return a.length ? a.reduce((s,v)=>s+v,0)/a.length : null;
  }
  function indexed(rows, geo){
    const m=new Map();
    rows.filter(r=>!geo || r.geo===geo).forEach(r=>m.set(key(r.sex,+r.age),n(r.value)));
    return m;
  }
  function getRate(rows,geo,year,sex,age,field="value"){
    const exact=rows.find(r=>r.geo===geo && +r.year===+year && r.sex===sex && +r.age===+age);
    if(exact) return n(exact[field]);
    const nat=rows.find(r=>r.geo==="SE" && +r.year===+year && r.sex===sex && +r.age===+age);
    return nat?n(nat[field]):0;
  }
  function getFert(rows,geo,year,age){
    const exact=rows.find(r=>r.geo===geo && +r.year===+year && +r.age===+age);
    if(exact) return n(exact.value);
    const nat=rows.find(r=>r.geo==="SE" && +r.year===+year && +r.age===+age);
    return nat?n(nat.value):0;
  }
  function getNetMig(rows,geo,year,sex,age){
    const exact=rows.find(r=>r.geo===geo && +r.year===+year && r.sex===sex && +r.age===+age);
    if(exact) return n(exact.value);
    const profile=rows.find(r=>r.geo===geo && r.year==="BASE" && r.sex===sex && +r.age===+age);
    return profile?n(profile.value):0;
  }
  function simulate(data, options){
    const geo=options.geo;
    const baseYear=+data.meta.baseYear;
    const endYear=+options.endYear;
    const fertMult=n(options.fertMult||1), mortMult=n(options.mortMult||1), migMult=n(options.migMult||1);
    const rows=data.populationBase.filter(r=>r.geo===geo && +r.year===baseYear);
    if(!rows.length) throw new Error(`Saknar startbefolkning för ${geo}, ${baseYear}.`);
    let pop=indexed(rows,geo);
    const results=[{year:baseYear,population:[...pop.values()].reduce((s,v)=>s+v,0),births:0,deaths:0,netMigration:0,change:0}];

    for(let year=baseYear+1;year<=endYear;year++){
      let births=0, deaths=0, netMigration=0;
      const survivors=new Map();
      for(const sex of ["K","M"]){
        for(let age=0;age<=MAX_AGE;age++){
          const p=n(pop.get(key(sex,age)));
          const q=clamp(getRate(data.mortalityRisks,geo,year,sex,age)*mortMult,0,1);
          const d=p*q; deaths+=d;
          const target=Math.min(MAX_AGE,age+1);
          survivors.set(key(sex,target),n(survivors.get(key(sex,target)))+(p-d));
        }
      }
      for(let age=15;age<=49;age++){
        const women=n(pop.get(key("K",age)));
        const f=Math.max(0,getFert(data.fertilityRates,geo,year,age)*fertMult);
        births += women*f;
      }
      const male=births*n(data.parameters.sexRatioMaleAtBirth||0.515);
      const female=births-male;
      survivors.set(key("M",0),n(survivors.get(key("M",0)))+male);
      survivors.set(key("K",0),n(survivors.get(key("K",0)))+female);

      for(const sex of ["K","M"]){
        for(let age=0;age<=MAX_AGE;age++){
          const mig=getNetMig(data.netMigration,geo,year,sex,age)*migMult;
          netMigration+=mig;
          survivors.set(key(sex,age),Math.max(0,n(survivors.get(key(sex,age)))+mig));
        }
      }
      const total=[...survivors.values()].reduce((s,v)=>s+v,0);
      const prev=results[results.length-1].population;
      results.push({year,population:total,births,deaths,netMigration,change:total-prev});
      pop=survivors;
    }
    return results;
  }
  global.RAPSModel={riskFromEvents,ckmMaxRelativePct,ckmRiskBounds,identityTransition,selectWindow,mean,simulate};
})(window);
