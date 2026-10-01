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
  function byWindow(row,window){
    return row.window==null || +row.window===+window;
  }
  function getRate(rows,geo,year,sex,age,window,field="value"){
    const exact=rows.find(r=>r.geo===geo && +r.year===+year && r.sex===sex && +r.age===+age && byWindow(r,window));
    if(exact) return n(exact[field]);
    const profile=rows.find(r=>r.geo===geo && r.year==null && r.sex===sex && +r.age===+age && byWindow(r,window));
    if(profile) return n(profile[field]);
    const nat=rows.find(r=>r.geo==="SE" && +r.year===+year && r.sex===sex && +r.age===+age && byWindow(r,window));
    return nat?n(nat[field]):0;
  }
  function getFert(rows,geo,year,age,window){
    const exact=rows.find(r=>r.geo===geo && +r.year===+year && +r.age===+age && byWindow(r,window));
    if(exact) return n(exact.value);
    const profile=rows.find(r=>r.geo===geo && r.year==null && +r.age===+age && byWindow(r,window));
    if(profile) return n(profile.value);
    const nat=rows.find(r=>r.geo==="SE" && +r.year===+year && +r.age===+age && byWindow(r,window));
    return nat?n(nat.value):0;
  }
  function getNetMig(rows,geo,year,sex,age,window){
    const exact=rows.find(r=>r.geo===geo && +r.year===+year && r.sex===sex && +r.age===+age && byWindow(r,window));
    if(exact) return n(exact.value);
    const profile=rows.find(r=>r.geo===geo && r.year==="BASE" && r.sex===sex && +r.age===+age && byWindow(r,window));
    return profile?n(profile.value):0;
  }

  function baseMunicipalityWeights(data){
    const members=(data.geographies.find(g=>g.code==="FA_LULEA")||{}).members||[];
    const totals={};
    for(const code of members){
      totals[code]=(data.populationBase||[])
        .filter(r=>r.geo===code && +r.year===+data.meta.baseYear)
        .reduce((s,r)=>s+n(r.value),0);
    }
    const sum=Object.values(totals).reduce((s,v)=>s+v,0);
    const weights={};
    for(const code of members) weights[code]=sum>0?totals[code]/sum:1/Math.max(1,members.length);
    return {members,weights};
  }

  function phasedAmount(total,startYear,phaseYears,year){
    const years=Math.max(1,Math.round(n(phaseYears)||1));
    if(year<startYear || year>=startYear+years) return 0;
    return total/years;
  }

  function destinationShares(host,members,weights,hostSharePct){
    const hostShare=clamp(n(hostSharePct)/100,0,1);
    const shares={};
    const otherWeight=members.filter(c=>c!==host).reduce((s,c)=>s+n(weights[c]),0);
    for(const c of members){
      if(c===host) shares[c]=hostShare;
      else shares[c]=(1-hostShare)*(otherWeight>0?n(weights[c])/otherWeight:1/Math.max(1,members.length-1));
    }
    return shares;
  }

  function observedCommutingShares(s,members){
    if(!s.useObservedCommuting || !s.commutingShares) return null;
    const raw={};
    let total=0;
    for(const code of members){
      raw[code]=Math.max(0,n(s.commutingShares[code]));
      total+=raw[code];
    }
    raw.OUTSIDE_FA=Math.max(0,n(s.commutingShares.OUTSIDE_FA));
    total+=raw.OUTSIDE_FA;
    if(total<=0) return null;

    const jobShares={};
    for(const code of members) jobShares[code]=raw[code]/total;
    jobShares.OUTSIDE_FA=raw.OUTSIDE_FA/total;

    const faTotal=members.reduce((sum,code)=>sum+jobShares[code],0);
    const faResidenceShares={};
    for(const code of members){
      faResidenceShares[code]=faTotal>0?jobShares[code]/faTotal:1/Math.max(1,members.length);
    }
    return {jobShares,faResidenceShares,commutingYear:s.commutingYear||null};
  }

  function scenarioMigrationProfile(data,geo,window,mode){
    if(!mode || mode==="population") return null;
    const rows=(data.scenarioMigrationProfiles||[]).filter(r=>
      r.geo===geo && +r.window===+window && r.profile===mode
    );
    return rows.length?rows:null;
  }

  function addProfileEffect(effects,amount,profileGeo,profileMode){
    if(!amount) return;
    effects.push({
      amount,
      profileGeo,
      profileMode:profileMode||"job_family"
    });
  }

  function scenarioEffect(data,options,year,geo){
    const scenarios=options.scenarios||{};
    const {members,weights}=baseMunicipalityWeights(data);
    let housingExternal=0,housingInternalNet=0,jobExternal=0,jobInternalNet=0;
    const jobExternalProfileEffects=[];

    for(const s of scenarios.housing||[]){
      if(!s.active) continue;
      const residents=n(s.dwellings)*n(s.completionPct)/100*n(s.occupancyPct)/100*n(s.personsPerDwelling);
      const externalTotal=residents*n(s.externalSharePct)/100;
      const internalTotal=residents*n(s.internalSharePct)/100;
      const ext=phasedAmount(externalTotal,+s.year,n(s.phaseYears),year);
      const intl=phasedAmount(internalTotal,+s.year,n(s.phaseYears),year);
      if(geo==="FA_LULEA"){
        housingExternal+=ext;
      }else if(members.includes(geo)){
        if(geo===s.municipality){
          housingExternal+=ext;
          housingInternalNet+=intl;
        }else{
          const denom=members.filter(c=>c!==s.municipality).reduce((sum,c)=>sum+n(weights[c]),0);
          housingInternalNet-=denom>0?intl*n(weights[geo])/denom:0;
        }
      }
    }

    for(const s of scenarios.workplaces||[]){
      if(!s.active) continue;
      const realizedJobs=n(s.jobs)*n(s.realizationPct)/100;
      const commuting=observedCommutingShares(s,members);

      if(commuting){
        // Observed commuting determines who is likely to hold the jobs.
        // It does NOT imply that commuters move residence.
        const outsideJobs=realizedJobs*n(commuting.jobShares.OUTSIDE_FA);
        const externalPeopleTotal=
          outsideJobs*n(s.moveSharePct)/100*n(s.personsPerJob);

        // If an external worker does relocate to FA, distribute that new
        // resident according to the observed residence pattern among current
        // FA-resident workers in the same workplace municipality.
        const ext=phasedAmount(
          externalPeopleTotal,+s.year,n(s.phaseYears),year
        );

        // A separate assumption can move some existing inter-municipal
        // commuters to the host municipality. This is a redistribution only:
        // it must net to zero across the FA municipalities.
        const internalMovePct=clamp(n(s.internalSharePct)/100,0,1);
        let internalPeopleTotal=0;
        const internalBySource={};
        for(const source of members){
          if(source===s.municipality) continue;
          const people=
            realizedJobs*n(commuting.jobShares[source])*
            internalMovePct*n(s.personsPerJob);
          internalBySource[source]=phasedAmount(
            people,+s.year,n(s.phaseYears),year
          );
          internalPeopleTotal+=internalBySource[source];
        }

        if(geo==="FA_LULEA"){
          jobExternal+=ext;
          for(const dest of members){
            addProfileEffect(
              jobExternalProfileEffects,
              ext*n(commuting.faResidenceShares[dest]),
              dest,
              s.ageProfileMode
            );
          }
        }else if(members.includes(geo)){
          const geoExternal=ext*n(commuting.faResidenceShares[geo]);
          jobExternal+=geoExternal;
          addProfileEffect(
            jobExternalProfileEffects,
            geoExternal,
            geo,
            s.ageProfileMode
          );
          if(geo===s.municipality){
            jobInternalNet+=internalPeopleTotal;
          }else{
            jobInternalNet-=n(internalBySource[geo]);
          }
        }
      }else{
        // Manual fallback retained for scenarios without commuting data.
        const externalTotal=realizedJobs*n(s.moveSharePct)/100*n(s.personsPerJob);
        const internalTotal=realizedJobs*n(s.internalSharePct)/100*n(s.personsPerJob);
        const ext=phasedAmount(externalTotal,+s.year,n(s.phaseYears),year);
        const intl=phasedAmount(internalTotal,+s.year,n(s.phaseYears),year);
        const dest=destinationShares(s.municipality,members,weights,s.hostResidencePct);
        if(geo==="FA_LULEA"){
          jobExternal+=ext;
          for(const code of members){
            addProfileEffect(
              jobExternalProfileEffects,
              ext*n(dest[code]),
              code,
              s.ageProfileMode
            );
          }
        }else if(members.includes(geo)){
          const geoExternal=ext*n(dest[geo]);
          jobExternal+=geoExternal;
          addProfileEffect(
            jobExternalProfileEffects,
            geoExternal,
            geo,
            s.ageProfileMode
          );
          jobInternalNet+=intl*(n(dest[geo])-n(weights[geo]));
        }
      }
    }

    const overlap=clamp(n(scenarios.overlapPct)/100,0,1);
    const overlapBase=Math.min(Math.max(0,housingExternal),Math.max(0,jobExternal))*overlap;
    const externalNet=housingExternal+jobExternal-overlapBase;
    return {
      total:externalNet+housingInternalNet+jobInternalNet,
      housingExternal,
      housingInternalNet,
      jobExternal,
      jobInternalNet,
      jobExternalProfileEffects,
      overlapDeduction:overlapBase
    };
  }

  function addScenarioToPopulation(pop,amount){
    if(!amount) return;
    const total=[...pop.values()].reduce((s,v)=>s+v,0);
    if(total<=0){
      pop.set(key("K",30),n(pop.get(key("K",30)))+amount*0.5);
      pop.set(key("M",30),n(pop.get(key("M",30)))+amount*0.5);
      return;
    }
    for(const [k,v] of pop.entries()){
      pop.set(k,Math.max(0,v+amount*(v/total)));
    }
  }

  function addScenarioWithProfile(pop,amount,profileRows){
    if(!amount) return;
    if(!profileRows || !profileRows.length){
      addScenarioToPopulation(pop,amount);
      return;
    }
    const totalShare=profileRows.reduce((s,r)=>s+Math.max(0,n(r.share)),0);
    if(totalShare<=0){
      addScenarioToPopulation(pop,amount);
      return;
    }
    for(const r of profileRows){
      const share=Math.max(0,n(r.share))/totalShare;
      if(!share) continue;
      const k=key(r.sex,+r.age);
      pop.set(k,Math.max(0,n(pop.get(k))+amount*share));
    }
  }

  function simulate(data, options){
    const geo=options.geo;
    const baseYear=+data.meta.baseYear;
    const endYear=+options.endYear;
    const fertMult=n(options.fertMult||1), mortMult=n(options.mortMult||1), migMult=n(options.migMult||1);
    const window=+(options.window || data.calibration?.defaultYears || 10);
    const rows=data.populationBase.filter(r=>r.geo===geo && +r.year===baseYear);
    if(!rows.length) throw new Error(`Saknar startbefolkning för ${geo}, ${baseYear}.`);
    let pop=indexed(rows,geo);
    const snapshot=()=>{
      if(!options.includeDetail) return undefined;
      const out=[];
      for(const sex of ["K","M"]){
        for(let age=0;age<=MAX_AGE;age++){
          out.push({sex,age,value:n(pop.get(key(sex,age)))});
        }
      }
      return out;
    };
    const results=[{
      year:baseYear,
      population:[...pop.values()].reduce((s,v)=>s+v,0),
      births:0,deaths:0,netMigration:0,scenarioEffect:0,change:0,
      populationByAgeSex:snapshot()
    }];

    for(let year=baseYear+1;year<=endYear;year++){
      let births=0, deaths=0, netMigration=0;
      const survivors=new Map();
      for(const sex of ["K","M"]){
        for(let age=0;age<=MAX_AGE;age++){
          const p=n(pop.get(key(sex,age)));
          const q=clamp(getRate(data.mortalityRisks,geo,year,sex,age,window)*mortMult,0,1);
          const d=p*q; deaths+=d;
          const target=Math.min(MAX_AGE,age+1);
          survivors.set(key(sex,target),n(survivors.get(key(sex,target)))+(p-d));
        }
      }
      for(let age=15;age<=49;age++){
        const women=n(pop.get(key("K",age)));
        const f=Math.max(0,getFert(data.fertilityRates,geo,year,age,window)*fertMult);
        births += women*f;
      }
      const male=births*n(data.parameters.sexRatioMaleAtBirth||0.515);
      const female=births-male;
      survivors.set(key("M",0),n(survivors.get(key("M",0)))+male);
      survivors.set(key("K",0),n(survivors.get(key("K",0)))+female);

      for(const sex of ["K","M"]){
        for(let age=0;age<=MAX_AGE;age++){
          const mig=getNetMig(data.netMigration,geo,year,sex,age,window)*migMult;
          netMigration+=mig;
          survivors.set(key(sex,age),Math.max(0,n(survivors.get(key(sex,age)))+mig));
        }
      }

      const sfx=scenarioEffect(data,options,year,geo);
      const profiledJobTotal=(sfx.jobExternalProfileEffects||[])
        .reduce((sum,e)=>sum+n(e.amount),0);
      const residualScenario=sfx.total-profiledJobTotal;
      addScenarioToPopulation(survivors,residualScenario);
      for(const e of sfx.jobExternalProfileEffects||[]){
        const profile=scenarioMigrationProfile(
          data,e.profileGeo,window,e.profileMode
        );
        addScenarioWithProfile(survivors,e.amount,profile);
      }

      const total=[...survivors.values()].reduce((s,v)=>s+v,0);
      const prev=results[results.length-1].population;
      pop=survivors;
      results.push({
        year,population:total,births,deaths,netMigration,
        scenarioEffect:sfx.total,scenarioDetail:sfx,change:total-prev,
        populationByAgeSex:snapshot()
      });
    }
    return results;
  }

  global.RAPSModel={riskFromEvents,ckmMaxRelativePct,ckmRiskBounds,identityTransition,selectWindow,mean,scenarioEffect,simulate};
})(window);
