(function(global){
  "use strict";
  const MAX_AGE = 100;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const key=(sex,age)=>`${sex}|${age}`;
  const bsKey=(status,sex,age)=>`${status}|${sex}|${age}`;
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

  // Model parameter arrays are large and are queried thousands of times per
  // simulation. Cache compact lookup indexes per source array so forecast
  // results remain identical to Array.find semantics while avoiding repeated
  // full-array scans.
  const ARRAY_INDEX_CACHE=new WeakMap();
  const EMPTY_INDEX=new Map();
  function yearKey(value){
    if(value==null) return "@null";
    if(value==="BASE") return "BASE";
    const x=Number(value);
    return Number.isFinite(x)?String(x):String(value);
  }
  function indexRows(rows,name,keyFn){
    if(!Array.isArray(rows)) return EMPTY_INDEX;
    let cache=ARRAY_INDEX_CACHE.get(rows);
    if(!cache){
      cache=new Map();
      ARRAY_INDEX_CACHE.set(rows,cache);
    }
    if(cache.has(name)) return cache.get(name);
    const idx=new Map();
    for(const row of rows){
      const k=keyFn(row);
      if(k==null) continue;
      const list=idx.get(k);
      if(list) list.push(row);
      else idx.set(k,[row]);
    }
    cache.set(name,idx);
    return idx;
  }
  function firstMatch(idx,key,predicate=null){
    const rows=idx.get(key)||[];
    if(!predicate) return rows[0]||null;
    return rows.find(predicate)||null;
  }

  function getRate(rows,geo,year,sex,age,window,field="value"){
    const idx=indexRows(
      rows,"rate",
      r=>`${r.geo}|${yearKey(r.year)}|${r.sex}|${+r.age}`
    );
    const suffix=`|${sex}|${+age}`;
    const exact=firstMatch(
      idx,`${geo}|${yearKey(year)}${suffix}`,r=>byWindow(r,window)
    );
    if(exact) return n(exact[field]);
    const profile=firstMatch(
      idx,`${geo}|@null${suffix}`,r=>byWindow(r,window)
    );
    if(profile) return n(profile[field]);
    const nat=firstMatch(
      idx,`SE|${yearKey(year)}${suffix}`,r=>byWindow(r,window)
    );
    return nat?n(nat[field]):0;
  }
  function getFert(rows,geo,year,age,window){
    const idx=indexRows(
      rows,"fert",
      r=>`${r.geo}|${yearKey(r.year)}|${+r.age}`
    );
    const suffix=`|${+age}`;
    const exact=firstMatch(
      idx,`${geo}|${yearKey(year)}${suffix}`,r=>byWindow(r,window)
    );
    if(exact) return n(exact.value);
    const profile=firstMatch(
      idx,`${geo}|@null${suffix}`,r=>byWindow(r,window)
    );
    if(profile) return n(profile.value);
    const nat=firstMatch(
      idx,`SE|${yearKey(year)}${suffix}`,r=>byWindow(r,window)
    );
    return nat?n(nat.value):0;
  }
  function getNetMig(rows,geo,year,sex,age,window){
    const idx=indexRows(
      rows,"netMig",
      r=>`${r.geo}|${yearKey(r.year)}|${r.sex}|${+r.age}`
    );
    const suffix=`|${sex}|${+age}`;
    const exact=firstMatch(
      idx,`${geo}|${yearKey(year)}${suffix}`,r=>byWindow(r,window)
    );
    if(exact) return n(exact.value);
    const profile=firstMatch(
      idx,`${geo}|BASE${suffix}`,r=>byWindow(r,window)
    );
    return profile?n(profile.value):0;
  }

  function getOutMigrationRisk(rows,geo,sex,age,window){
    const idx=indexRows(
      rows,"outRisk",
      r=>`${r.geo}|${r.sex}|${+r.age}`
    );
    const r=firstMatch(
      idx,`${geo}|${sex}|${+age}`,x=>byWindow(x,window)
    );
    return r?clamp(n(r.value),0,1):0;
  }
  function getGrossInMigration(rows,geo,sex,age,window){
    const idx=indexRows(
      rows,"grossIn",
      r=>`${r.geo}|${r.sex}|${+r.age}`
    );
    const r=firstMatch(
      idx,`${geo}|${sex}|${+age}`,
      x=>(x.year==="BASE" || x.year==null) && byWindow(x,window)
    );
    return r?Math.max(0,n(r.value)):0;
  }

  function getMigrationComponentRow(rows,geo,leg,sex,age,window){
    const idx=indexRows(
      rows,"migrationComponent",
      r=>`${r.geo}|${r.leg}|${r.sex}|${+r.age}|${+r.window}`
    );
    return firstMatch(
      idx,`${geo}|${leg}|${sex}|${+age}|${+window}`
    );
  }
  function getMigrationRecencyOutRow(rows,geo,leg,sex,age){
    const idx=indexRows(
      rows,"migrationRecencyOut",
      r=>`${r.geo}|${r.leg}|${r.sex}|${+r.age}`
    );
    return firstMatch(idx,`${geo}|${leg}|${sex}|${+age}`);
  }

  function componentWindows(data){
    const cfg=data.parameters?.migrationComponentWindows||{};
    return {
      county:{in:+(cfg.county?.inflowWindow||10),out:+(cfg.county?.outflowWindow||10)},
      rest_sweden:{in:+(cfg.rest_sweden?.inflowWindow||10),out:+(cfg.rest_sweden?.outflowWindow||10)},
      international:{in:+(cfg.international?.inflowWindow||10),out:+(cfg.international?.outflowWindow||10)}
    };
  }

  function getScbRiskRow(rows,geo,leg,sex,age){
    const idx=indexRows(
      rows,"scbRisk",
      r=>`${r.geo}|${r.leg}|${r.sex}|${+r.age}`
    );
    return firstMatch(idx,`${geo}|${leg}|${sex}|${+age}`);
  }
  function getScbDomesticInLevel(rows,geo,leg){
    const idx=indexRows(rows,"scbDomesticLevel",r=>`${r.geo}|${r.leg}`);
    return firstMatch(idx,`${geo}|${leg}`);
  }
  function getScbDomesticInDistribution(rows,geo,leg,sex,age){
    const idx=indexRows(
      rows,"scbDomesticDistribution",
      r=>`${r.geo}|${r.leg}|${r.sex}|${+r.age}`
    );
    return firstMatch(idx,`${geo}|${leg}|${sex}|${+age}`);
  }
  function getScbInternationalInRow(rows,geo,sex,age){
    const idx=indexRows(
      rows,"scbInternationalIn",
      r=>`${r.geo}|${r.sex}|${+r.age}`
    );
    return firstMatch(idx,`${geo}|${sex}|${+age}`);
  }
  function getScbNationalPopulation(rows,year,sex,age){
    const idx=indexRows(
      rows,"scbNationalPopulation",
      r=>`${yearKey(r.year)}|${r.sex}|${+r.age}`
    );
    const r=firstMatch(idx,`${yearKey(year)}|${sex}|${+age}`);
    return r?Math.max(0,n(r.value)):0;
  }
  function getScbNationalImmigration(rows,year){
    const idx=indexRows(rows,"scbNationalImmigration",r=>yearKey(r.year));
    const r=firstMatch(idx,yearKey(year));
    return r?Math.max(0,n(r.value)):0;
  }

  function getProfetBirthLevel(rows,geo,status,leg){
    const idx=indexRows(
      rows,"profetBirthLevel",
      r=>`${r.geo}|${r.status}|${r.leg}`
    );
    return firstMatch(idx,`${geo}|${status}|${leg}`);
  }
  function getProfetBirthDistribution(rows,geo,status,leg,sex,age){
    const idx=indexRows(
      rows,"profetBirthDistribution",
      r=>`${r.geo}|${r.status}|${r.leg}|${r.sex}|${+r.age}`
    );
    return firstMatch(
      idx,`${geo}|${status}|${leg}|${sex}|${+age}`
    );
  }
  function getProfetBirthOut(rows,geo,status,leg,sex,age){
    const idx=indexRows(
      rows,"profetBirthOut",
      r=>`${r.geo}|${r.status}|${r.leg}|${r.sex}|${+r.age}`
    );
    return firstMatch(
      idx,`${geo}|${status}|${leg}|${sex}|${+age}`
    );
  }
  function getProfetBirthInternationalIn(rows,geo,status,sex,age){
    const idx=indexRows(
      rows,"profetBirthIntlIn",
      r=>`${r.geo}|${r.status}|${r.sex}|${+r.age}`
    );
    return firstMatch(idx,`${geo}|${status}|${sex}|${+age}`);
  }
  function getProfetBirthNationalPopulation(rows,year,status){
    const idx=indexRows(
      rows,"profetBirthNationalPopulation",
      r=>`${yearKey(r.year)}|${r.status}`
    );
    return (idx.get(`${yearKey(year)}|${status}`)||[])
      .reduce((sum,r)=>sum+Math.max(0,n(r.value)),0);
  }
  function getProfetBirthNationalImmigration(rows,year,status){
    const idx=indexRows(
      rows,"profetBirthNationalImmigration",
      r=>`${yearKey(r.year)}|${r.status}`
    );
    const r=firstMatch(idx,`${yearKey(year)}|${status}`);
    return r?Math.max(0,n(r.value)):0;
  }
  function getProfetConsistencyFactor(rows,year,leg,direction){
    const idx=indexRows(
      rows,"profetConsistencyFactor",
      r=>`${yearKey(r.year)}|${r.leg}|${r.direction}`
    );
    const r=firstMatch(
      idx,`${yearKey(year)}|${leg}|${direction}`
    );
    return r?Math.max(0,n(r.value)):1;
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

  function splitWorkerHousehold(movingJobs,personsPerJob,startYear,phaseYears,year){
    const ppj=Math.max(0,n(personsPerJob));
    const workersTotal=movingJobs*Math.min(1,ppj);
    const companionsTotal=movingJobs*Math.max(0,ppj-1);
    return {
      workers:phasedAmount(workersTotal,startYear,phaseYears,year),
      companions:phasedAmount(companionsTotal,startYear,phaseYears,year)
    };
  }

  function scenarioEffect(data,options,year,geo){
    const scenarios=options.scenarios||{};
    const {members,weights}=baseMunicipalityWeights(data);
    let housingExternal=0,housingInternalNet=0,jobExternal=0,jobInternalNet=0;
    let jobExternalDomestic=0,jobExternalInternational=0;
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
      const directRealizedJobs=n(s.jobs)*n(s.realizationPct)/100;
      // spinOffJobsPerDirectJob is additional employment generated outside
      // the direct industrial establishment. Example: 1.5 means 1 direct
      // realised job + 1.5 additional jobs = 2.5 jobs in the scenario's
      // total labour-demand effect. Missing field stays 0 for backwards
      // compatibility with previously saved scenarios.
      const spinOffJobsPerDirectJob=Math.max(0,n(s.spinOffJobsPerDirectJob));
      const spinOffJobs=directRealizedJobs*spinOffJobsPerDirectJob;
      const realizedJobs=directRealizedJobs+spinOffJobs;
      const internationalShare=clamp(n(s.internationalRecruitmentSharePct)/100,0,1);
      const commuting=observedCommutingShares(s,members);

      if(commuting){
        // Observed commuting determines who is likely to hold the jobs.
        // It does NOT imply that commuters move residence.
        const outsideJobs=realizedJobs*n(commuting.jobShares.OUTSIDE_FA);
        const movingJobs=
          outsideJobs*clamp(n(s.moveSharePct)/100,0,1);
        const split=splitWorkerHousehold(
          movingJobs,n(s.personsPerJob),+s.year,n(s.phaseYears),year
        );
        const ext=split.workers+split.companions;

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
          jobExternalInternational+=ext*internationalShare;
          jobExternalDomestic+=ext*(1-internationalShare);
          for(const dest of members){
            const destShare=n(commuting.faResidenceShares[dest]);
            if(s.ageProfileMode==="worker_household"){
              addProfileEffect(
                jobExternalProfileEffects,
                split.workers*destShare,
                s.municipality,
                "worker_hybrid"
              );
              addProfileEffect(
                jobExternalProfileEffects,
                split.companions*destShare,
                dest,
                "family_companion"
              );
            }else{
              addProfileEffect(
                jobExternalProfileEffects,
                ext*destShare,
                dest,
                s.ageProfileMode
              );
            }
          }
        }else if(members.includes(geo)){
          const destShare=n(commuting.faResidenceShares[geo]);
          const geoExternal=ext*destShare;
          jobExternal+=geoExternal;
          jobExternalInternational+=geoExternal*internationalShare;
          jobExternalDomestic+=geoExternal*(1-internationalShare);
          if(s.ageProfileMode==="worker_household"){
            addProfileEffect(
              jobExternalProfileEffects,
              split.workers*destShare,
              s.municipality,
              "worker_hybrid"
            );
            addProfileEffect(
              jobExternalProfileEffects,
              split.companions*destShare,
              geo,
              "family_companion"
            );
          }else{
            addProfileEffect(
              jobExternalProfileEffects,
              geoExternal,
              geo,
              s.ageProfileMode
            );
          }
          if(geo===s.municipality){
            jobInternalNet+=internalPeopleTotal;
          }else{
            jobInternalNet-=n(internalBySource[geo]);
          }
        }
      }else{
        // Manual fallback retained for scenarios without commuting data.
        const movingJobs=
          realizedJobs*clamp(n(s.moveSharePct)/100,0,1);
        const split=splitWorkerHousehold(
          movingJobs,n(s.personsPerJob),+s.year,n(s.phaseYears),year
        );
        const ext=split.workers+split.companions;
        const internalTotal=realizedJobs*n(s.internalSharePct)/100*n(s.personsPerJob);
        const intl=phasedAmount(internalTotal,+s.year,n(s.phaseYears),year);
        const dest=destinationShares(s.municipality,members,weights,s.hostResidencePct);
        if(geo==="FA_LULEA"){
          jobExternal+=ext;
          jobExternalInternational+=ext*internationalShare;
          jobExternalDomestic+=ext*(1-internationalShare);
          for(const code of members){
            const destShare=n(dest[code]);
            if(s.ageProfileMode==="worker_household"){
              addProfileEffect(
                jobExternalProfileEffects,
                split.workers*destShare,
                s.municipality,
                "worker_hybrid"
              );
              addProfileEffect(
                jobExternalProfileEffects,
                split.companions*destShare,
                code,
                "family_companion"
              );
            }else{
              addProfileEffect(
                jobExternalProfileEffects,
                ext*destShare,
                code,
                s.ageProfileMode
              );
            }
          }
        }else if(members.includes(geo)){
          const destShare=n(dest[geo]);
          const geoExternal=ext*destShare;
          jobExternal+=geoExternal;
          jobExternalInternational+=geoExternal*internationalShare;
          jobExternalDomestic+=geoExternal*(1-internationalShare);
          if(s.ageProfileMode==="worker_household"){
            addProfileEffect(
              jobExternalProfileEffects,
              split.workers*destShare,
              s.municipality,
              "worker_hybrid"
            );
            addProfileEffect(
              jobExternalProfileEffects,
              split.companions*destShare,
              geo,
              "family_companion"
            );
          }else{
            addProfileEffect(
              jobExternalProfileEffects,
              geoExternal,
              geo,
              s.ageProfileMode
            );
          }
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
      jobExternalDomestic,
      jobExternalInternational,
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

  function simulateProfetBirthStatus(
    data,options,fertilityRows,window,cohortTimingMode,
    fertMult,mortMult,imigMult,umigMult
  ){
    if(cohortTimingMode!=="event_age_aligned"){
      throw new Error("Profet födelsestatus-kandidaten kräver event-age-aligned timing.");
    }
    const geo=options.geo;
    const baseYear=+data.meta.baseYear;
    const endYear=+options.endYear;
    const statuses=["sweden_born","foreign_born"];
    const useConsistency=options.consistencyAdjustment===true;
    const profetMode=useConsistency
      ?"profet_birth_status_consistent"
      :"profet_birth_status";
    const baseRows=(data.populationBaseBirthStatus||[])
      .filter(r=>r.geo===geo && +r.year===baseYear);
    if(!baseRows.length){
      throw new Error(`Saknar startbefolkning efter födelsestatus för ${geo}, ${baseYear}.`);
    }
    const pop=new Map();
    for(const status of statuses){
      for(const sex of ["K","M"]){
        for(let age=0;age<=MAX_AGE;age++){
          const r=baseRows.find(
            x=>x.status===status&&x.sex===sex&&+x.age===age
          );
          pop.set(bsKey(status,sex,age),Math.max(0,n(r?.value)));
        }
      }
    }
    const snapshot=()=>{
      if(!options.includeDetail) return undefined;
      const out=[];
      for(const sex of ["K","M"]){
        for(let age=0;age<=MAX_AGE;age++){
          out.push({
            sex,age,
            value:statuses.reduce(
              (sum,status)=>sum+n(pop.get(bsKey(status,sex,age))),0
            )
          });
        }
      }
      return out;
    };
    const statusSnapshot=()=>Object.fromEntries(
      statuses.map(status=>[
        status,
        [...pop.entries()]
          .filter(([k])=>k.startsWith(status+"|"))
          .reduce((sum,[,v])=>sum+n(v),0)
      ])
    );
    const totalPop=()=>[...pop.values()].reduce((sum,v)=>sum+n(v),0);
    const results=[{
      year:baseYear,population:totalPop(),births:0,deaths:0,netMigration:0,
      grossInMigration:0,grossOutMigration:0,
      migrationMode:profetMode,
      migrationWindow:10,cohortTimingMode,
      fertilityScenario:options.fertilityScenario||data.parameters?.defaultFertilityScenario||"raps2024",
      scenarioEffect:0,change:0,
      populationByAgeSex:snapshot(),
      populationByBirthStatus:statusSnapshot()
    }];

    for(let year=baseYear+1;year<=endYear;year++){
      let births=0,deaths=0,netMigration=0;
      let grossInMigration=0,grossOutMigration=0;
      const aged=new Map();
      for(const status of statuses){
        for(const sex of ["K","M"]){
          for(let age=0;age<=MAX_AGE;age++){
            const target=Math.min(MAX_AGE,age+1);
            const k=bsKey(status,sex,target);
            aged.set(k,n(aged.get(k))+n(pop.get(bsKey(status,sex,age))));
          }
        }
      }

      for(let age=15;age<=49;age++){
        const women=statuses.reduce(
          (sum,status)=>sum+n(aged.get(bsKey(status,"K",age))),0
        );
        births+=women*Math.max(
          0,getFert(fertilityRows,geo,year,age,window)*fertMult
        );
      }
      const male=births*n(data.parameters.sexRatioMaleAtBirth||0.515);
      const female=births-male;
      aged.set(
        bsKey("sweden_born","M",0),
        n(aged.get(bsKey("sweden_born","M",0)))+male
      );
      aged.set(
        bsKey("sweden_born","K",0),
        n(aged.get(bsKey("sweden_born","K",0)))+female
      );

      const survivors=new Map();
      for(const status of statuses){
        for(const sex of ["K","M"]){
          for(let age=0;age<=MAX_AGE;age++){
            const p=n(aged.get(bsKey(status,sex,age)));
            const q=clamp(
              getRate(data.mortalityRisks,geo,year,sex,age,window)*mortMult,
              0,1
            );
            const d=p*q;
            deaths+=d;
            survivors.set(bsKey(status,sex,age),Math.max(0,p-d));
          }
        }
      }

      const statusMunicipalTotals=Object.fromEntries(
        statuses.map(status=>[
          status,
          [...survivors.entries()]
            .filter(([k])=>k.startsWith(status+"|"))
            .reduce((sum,[,v])=>sum+n(v),0)
        ])
      );
      const domesticTotals={};
      for(const status of statuses){
        const nationalPop=getProfetBirthNationalPopulation(
          data.profetBirthStatusNationalMeanPopulation,year,status
        );
        const restPop=Math.max(
          0,nationalPop-n(statusMunicipalTotals[status])
        );
        domesticTotals[status]={};
        for(const leg of ["county","rest_sweden"]){
          const level=getProfetBirthLevel(
            data.profetBirthStatusDomesticInLevels,geo,status,leg
          );
          domesticTotals[status][leg]=Math.max(0,n(level?.value))*restPop;
        }
      }

      for(const status of statuses){
        const nationalImmigration=getProfetBirthNationalImmigration(
          data.profetBirthStatusNationalImmigration,year,status
        );
        for(const sex of ["K","M"]){
          for(let age=0;age<=MAX_AGE;age++){
            const k=bsKey(status,sex,age);
            const p=n(survivors.get(k));
            let incoming=0,totalOutRisk=0;
            for(const leg of ["county","rest_sweden"]){
              const dist=getProfetBirthDistribution(
                data.profetBirthStatusDomesticInDistribution,
                geo,status,leg,sex,age
              );
              const inFactor=useConsistency
                ?getProfetConsistencyFactor(
                  data.profetConsistencyFactors,year,leg,"in"
                )
                :1;
              incoming+=
                Math.max(0,n(domesticTotals[status][leg]))*
                Math.max(0,n(dist?.share))*
                inFactor;
              const out=getProfetBirthOut(
                data.profetBirthStatusOutMigration,
                geo,status,leg,sex,age
              );
              const outFactor=useConsistency
                ?getProfetConsistencyFactor(
                  data.profetConsistencyFactors,year,leg,"out"
                )
                :1;
              totalOutRisk+=Math.max(0,n(out?.value))*outFactor;
            }
            const intlIn=getProfetBirthInternationalIn(
              data.profetBirthStatusInternationalInMigration,
              geo,status,sex,age
            );
            const intlInFactor=useConsistency
              ?getProfetConsistencyFactor(
                data.profetConsistencyFactors,year,"international","in"
              )
              :1;
            incoming+=
              nationalImmigration*
              Math.max(0,n(intlIn?.municipalityShare))*
              Math.max(0,n(intlIn?.ageSexShare))*
              intlInFactor;
            const intlOut=getProfetBirthOut(
              data.profetBirthStatusOutMigration,
              geo,status,"international",sex,age
            );
            const intlOutFactor=useConsistency
              ?getProfetConsistencyFactor(
                data.profetConsistencyFactors,year,"international","out"
              )
              :1;
            totalOutRisk+=Math.max(0,n(intlOut?.value))*intlOutFactor;

            incoming*=imigMult;
            const outgoing=Math.min(
              p,p*clamp(totalOutRisk*umigMult,0,1)
            );
            grossInMigration+=incoming;
            grossOutMigration+=outgoing;
            netMigration+=incoming-outgoing;
            survivors.set(k,Math.max(0,p-outgoing+incoming));
          }
        }
      }

      const prev=results.at(-1).population;
      pop.clear();
      for(const [k,v] of survivors) pop.set(k,v);
      const total=totalPop();
      results.push({
        year,population:total,births,deaths,netMigration,
        grossInMigration,grossOutMigration,
        migrationMode:profetMode,
        migrationWindow:10,cohortTimingMode,
        fertilityScenario:options.fertilityScenario||data.parameters?.defaultFertilityScenario||"raps2024",
        scenarioEffect:0,change:total-prev,
        populationByAgeSex:snapshot(),
        populationByBirthStatus:statusSnapshot()
      });
    }
    return results;
  }

  function simulateSingleGeo(data, options){
    const geo=options.geo;
    const baseYear=+data.meta.baseYear;
    const endYear=+options.endYear;
    const fertMult=n(options.fertMult==null?1:options.fertMult),
      mortMult=n(options.mortMult==null?1:options.mortMult),
      migMult=n(options.migMult==null?1:options.migMult);
    const migrationMode=options.migrationMode||"net";
    const cohortTimingMode=options.cohortTimingMode||data.parameters?.cohortTimingMode||"event_age_aligned";
    const fertilityScenario=options.fertilityScenario||data.parameters?.defaultFertilityScenario||"raps2024";
    const fertilityRows=fertilityScenario==="raps2024"
      ? (data.fertilityRates||[])
      : (data.fertilityScenarioRates||[]).filter(r=>r.scenario===fertilityScenario);
    if(fertilityScenario!=="raps2024" && !fertilityRows.length){
      throw new Error(`Saknar fruktsamhetsscenario ${fertilityScenario}.`);
    }
    const imigMult=options.imigMult==null?migMult:n(options.imigMult);
    const umigMult=options.umigMult==null?migMult:n(options.umigMult);
    const window=+(options.window || data.calibration?.defaultYears || 10);
    const migrationWindows=(data.diagnostics?.migrationCalibrationWindows||[2,3,4,6,10]).map(Number);
    const migrationWindow=+(
      options.migrationWindow ||
      (migrationWindows.includes(window) ? window : (data.parameters?.defaultMigrationWindow || 10))
    );
    const rows=data.populationBase.filter(r=>r.geo===geo && +r.year===baseYear);
    if(!rows.length) throw new Error(`Saknar startbefolkning för ${geo}, ${baseYear}.`);
    if(migrationMode==="gross_flow"){
      const hasOut=(data.outMigrationRisks||[]).some(r=>r.geo===geo && +r.window===window);
      const hasIn=(data.grossInMigration||[]).some(r=>r.geo===geo && +r.window===window);
      if(!hasOut || !hasIn){
        throw new Error(`Saknar bruttoflyttningsunderlag för ${geo}, ${window} år.`);
      }
    }
    if(migrationMode==="component_flow" || migrationMode==="component_recency"){
      const cw=componentWindows(data);
      const legs=["county","rest_sweden","international"];
      const missing=legs.filter(leg=>
        !(data.migrationComponentInflow||[]).some(r=>r.geo===geo&&r.leg===leg&&+r.window===cw[leg].in) ||
        !(data.migrationComponentOutHazards||[]).some(r=>r.geo===geo&&r.leg===leg&&+r.window===cw[leg].out)
      );
      if(missing.length){
        throw new Error(`Saknar komponentflyttningsunderlag för ${geo}: ${missing.join(", ")}.`);
      }
      if(migrationMode==="component_recency"){
        const adaptiveLeg=data.parameters?.migrationRecencyCandidate?.candidate?.adaptiveLeg||"rest_sweden";
        const hasRecency=(data.migrationRecencyOutHazards||[]).some(
          r=>r.geo===geo&&r.leg===adaptiveLeg
        );
        if(!hasRecency){
          throw new Error(`Saknar adaptivt utflyttningsunderlag för ${geo}, ${adaptiveLeg}.`);
        }
      }
    }
    if(migrationMode==="scb_risk_flow"){
      const domesticLegs=["county","rest_sweden"];
      const missingLevels=domesticLegs.filter(leg=>
        !(data.scbRiskDomesticInLevels||[]).some(r=>r.geo===geo&&r.leg===leg)
      );
      const missingDistributions=domesticLegs.filter(leg=>
        !(data.scbRiskDomesticInDistribution||[]).some(r=>r.geo===geo&&r.leg===leg)
      );
      const missingOut=["county","rest_sweden","international"].filter(leg=>
        !(data.scbRiskOutMigration||[]).some(r=>r.geo===geo&&r.leg===leg)
      );
      const hasIntlIn=(data.scbRiskInternationalInMigration||[]).some(r=>r.geo===geo);
      const hasNationalPop=(data.scbRiskNationalMeanPopulation||[]).length>0;
      const hasNationalImmigration=(data.scbRiskNationalImmigration||[]).length>0;
      if(missingLevels.length||missingDistributions.length||missingOut.length||!hasIntlIn||!hasNationalPop||!hasNationalImmigration){
        throw new Error(
          `Saknar SCB-riskflyttningsunderlag för ${geo}.`
        );
      }
    }
    if(migrationMode==="profet_birth_status"){
      const hasBase=(data.populationBaseBirthStatus||[])
        .some(r=>r.geo===geo&&+r.year===baseYear);
      const hasLevels=(data.profetBirthStatusDomesticInLevels||[])
        .some(r=>r.geo===geo);
      const hasDist=(data.profetBirthStatusDomesticInDistribution||[])
        .some(r=>r.geo===geo);
      const hasOut=(data.profetBirthStatusOutMigration||[])
        .some(r=>r.geo===geo);
      const hasIntl=(data.profetBirthStatusInternationalInMigration||[])
        .some(r=>r.geo===geo);
      const hasNatPop=(data.profetBirthStatusNationalMeanPopulation||[]).length>0;
      const hasNatIn=(data.profetBirthStatusNationalImmigration||[]).length>0;
      if(!hasBase||!hasLevels||!hasDist||!hasOut||!hasIntl||!hasNatPop||!hasNatIn){
        throw new Error(`Saknar Profet-underlag efter födelsestatus för ${geo}.`);
      }
      if(options.consistencyAdjustment===true){
        const neededYears=[];
        for(let y=baseYear+1;y<=endYear;y++) neededYears.push(y);
        const legs=["county","rest_sweden","international"];
        const missing=neededYears.flatMap(y=>
          legs.flatMap(leg=>
            ["in","out"]
              .filter(direction=>
                !(data.profetConsistencyFactors||[]).some(
                  r=>+r.year===y&&r.leg===leg&&r.direction===direction
                )
              )
              .map(direction=>`${y}:${leg}:${direction}`)
          )
        );
        if(missing.length){
          throw new Error(
            `Saknar Profet-konsistensfaktorer för ${geo}: ${missing.join(", ")}.`
          );
        }
      }
      return simulateProfetBirthStatus(
        data,options,fertilityRows,window,cohortTimingMode,
        fertMult,mortMult,imigMult,umigMult
      );
    }

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
      births:0,deaths:0,netMigration:0,
      grossInMigration:(migrationMode==="gross_flow"||migrationMode==="component_flow"||migrationMode==="component_recency"||migrationMode==="scb_risk_flow")?0:null,
      grossOutMigration:(migrationMode==="gross_flow"||migrationMode==="component_flow"||migrationMode==="component_recency"||migrationMode==="scb_risk_flow")?0:null,
      migrationMode,
      migrationWindow,
      cohortTimingMode,
      fertilityScenario,
      scenarioEffect:0,change:0,
      populationByAgeSex:snapshot()
    }];

    for(let year=baseYear+1;year<=endYear;year++){
      let births=0, deaths=0, netMigration=0;
      let grossInMigration=0, grossOutMigration=0;
      let survivors=new Map();

      if(cohortTimingMode==="event_age_aligned"){
        // SCB birth-year event ages refer to attained age at the end of the
        // forecast year. Age the 31-December stock first, then apply
        // age-at-event fertility/mortality to those forecast-year ages.
        // Newborns are added before mortality so age-0 deaths can occur in
        // their birth year.
        const eventAgePopulation=new Map();
        for(const sex of ["K","M"]){
          for(let age=0;age<=MAX_AGE;age++){
            const target=Math.min(MAX_AGE,age+1);
            eventAgePopulation.set(
              key(sex,target),
              n(eventAgePopulation.get(key(sex,target)))+
              n(pop.get(key(sex,age)))
            );
          }
        }

        for(let age=15;age<=49;age++){
          const women=n(eventAgePopulation.get(key("K",age)));
          const f=Math.max(
            0,
            getFert(fertilityRows,geo,year,age,window)*fertMult
          );
          births += women*f;
        }
        const male=births*n(data.parameters.sexRatioMaleAtBirth||0.515);
        const female=births-male;
        eventAgePopulation.set(
          key("M",0),
          n(eventAgePopulation.get(key("M",0)))+male
        );
        eventAgePopulation.set(
          key("K",0),
          n(eventAgePopulation.get(key("K",0)))+female
        );

        for(const sex of ["K","M"]){
          for(let age=0;age<=MAX_AGE;age++){
            const p=n(eventAgePopulation.get(key(sex,age)));
            const q=clamp(
              getRate(data.mortalityRisks,geo,year,sex,age,window)*mortMult,
              0,1
            );
            const d=p*q;
            deaths+=d;
            survivors.set(key(sex,age),Math.max(0,p-d));
          }
        }
      }else{
        // Legacy V1 timing is retained only for validation and historical
        // comparison. Production uses event-age aligned timing by default.
        for(const sex of ["K","M"]){
          for(let age=0;age<=MAX_AGE;age++){
            const p=n(pop.get(key(sex,age)));
            const q=clamp(
              getRate(data.mortalityRisks,geo,year,sex,age,window)*mortMult,
              0,1
            );
            const d=p*q;
            deaths+=d;
            const target=Math.min(MAX_AGE,age+1);
            survivors.set(
              key(sex,target),
              n(survivors.get(key(sex,target)))+(p-d)
            );
          }
        }
        for(let age=15;age<=49;age++){
          const women=n(pop.get(key("K",age)));
          const f=Math.max(
            0,
            getFert(fertilityRows,geo,year,age,window)*fertMult
          );
          births += women*f;
        }
        const male=births*n(data.parameters.sexRatioMaleAtBirth||0.515);
        const female=births-male;
        survivors.set(key("M",0),n(survivors.get(key("M",0)))+male);
        survivors.set(key("K",0),n(survivors.get(key("K",0)))+female);
      }

      if(migrationMode==="gross_flow"){
        for(const sex of ["K","M"]){
          for(let age=0;age<=MAX_AGE;age++){
            const k=key(sex,age);
            const p=n(survivors.get(k));
            const incoming=getGrossInMigration(
              data.grossInMigration,geo,sex,age,window
            )*imigMult;
            const risk=clamp(
              getOutMigrationRisk(data.outMigrationRisks,geo,sex,age,window)*umigMult,
              0,1
            );
            const outgoing=Math.min(p,p*risk);
            grossInMigration+=incoming;
            grossOutMigration+=outgoing;
            netMigration+=incoming-outgoing;
            survivors.set(k,Math.max(0,p-outgoing+incoming));
          }
        }
      }else if(migrationMode==="component_flow" || migrationMode==="component_recency"){
        const cw=componentWindows(data);
        const legs=["county","rest_sweden","international"];
        const adaptiveLeg=data.parameters?.migrationRecencyCandidate?.candidate?.adaptiveLeg||"rest_sweden";
        for(const sex of ["K","M"]){
          for(let age=0;age<=MAX_AGE;age++){
            const k=key(sex,age);
            const p=n(survivors.get(k));
            let incoming=0;
            let totalHazard=0;
            for(const leg of legs){
              const inRow=getMigrationComponentRow(
                data.migrationComponentInflow,geo,leg,sex,age,cw[leg].in
              );
              let outRow=getMigrationComponentRow(
                data.migrationComponentOutHazards,geo,leg,sex,age,cw[leg].out
              );
              if(migrationMode==="component_recency" && leg===adaptiveLeg){
                outRow=getMigrationRecencyOutRow(
                  data.migrationRecencyOutHazards,geo,leg,sex,age
                )||outRow;
              }
              incoming+=Math.max(0,n(inRow?.value))*imigMult;
              totalHazard+=Math.max(0,n(outRow?.value))*umigMult;
            }
            const risk=clamp(1-Math.exp(-totalHazard),0,1);
            const outgoing=Math.min(p,p*risk);
            grossInMigration+=incoming;
            grossOutMigration+=outgoing;
            netMigration+=incoming-outgoing;
            survivors.set(k,Math.max(0,p-outgoing+incoming));
          }
        }
      }else if(migrationMode==="scb_risk_flow"){
        const nationalImmigration=getScbNationalImmigration(
          data.scbRiskNationalImmigration,year
        );
        const nationalPopulationTotal=(data.scbRiskNationalMeanPopulation||[])
          .filter(r=>+r.year===+year)
          .reduce((sum,r)=>sum+Math.max(0,n(r.value)),0);
        const municipalPopulationTotal=[...survivors.values()]
          .reduce((sum,v)=>sum+Math.max(0,n(v)),0);
        const restPopulationTotal=Math.max(
          0,nationalPopulationTotal-municipalPopulationTotal
        );
        const domesticTotals={};
        for(const leg of ["county","rest_sweden"]){
          const level=getScbDomesticInLevel(
            data.scbRiskDomesticInLevels,geo,leg
          );
          domesticTotals[leg]=
            Math.max(0,n(level?.value))*restPopulationTotal;
        }

        for(const sex of ["K","M"]){
          for(let age=0;age<=MAX_AGE;age++){
            const k=key(sex,age);
            const p=n(survivors.get(k));

            let domesticIncoming=0;
            let totalOutRisk=0;
            for(const leg of ["county","rest_sweden"]){
              const distribution=getScbDomesticInDistribution(
                data.scbRiskDomesticInDistribution,geo,leg,sex,age
              );
              domesticIncoming+=
                Math.max(0,n(domesticTotals[leg]))*
                Math.max(0,n(distribution?.share));
              const outRow=getScbRiskRow(
                data.scbRiskOutMigration,geo,leg,sex,age
              );
              totalOutRisk+=Math.max(0,n(outRow?.value));
            }

            const intlIn=getScbInternationalInRow(
              data.scbRiskInternationalInMigration,geo,sex,age
            );
            const internationalIncoming=
              nationalImmigration*
              Math.max(0,n(intlIn?.municipalityShare))*
              Math.max(0,n(intlIn?.ageSexShare));

            const intlOut=getScbRiskRow(
              data.scbRiskOutMigration,geo,"international",sex,age
            );
            totalOutRisk+=Math.max(0,n(intlOut?.value));

            const incoming=(domesticIncoming+internationalIncoming)*imigMult;
            const outRisk=clamp(totalOutRisk*umigMult,0,1);
            const outgoing=Math.min(p,p*outRisk);

            grossInMigration+=incoming;
            grossOutMigration+=outgoing;
            netMigration+=incoming-outgoing;
            survivors.set(k,Math.max(0,p-outgoing+incoming));
          }
        }
      }else{
        for(const sex of ["K","M"]){
          for(let age=0;age<=MAX_AGE;age++){
            const mig=getNetMig(data.netMigration,geo,year,sex,age,migrationWindow)*migMult;
            netMigration+=mig;
            survivors.set(key(sex,age),Math.max(0,n(survivors.get(key(sex,age)))+mig));
          }
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
        grossInMigration:(migrationMode==="gross_flow"||migrationMode==="component_flow"||migrationMode==="component_recency"||migrationMode==="scb_risk_flow")?grossInMigration:null,
        grossOutMigration:(migrationMode==="gross_flow"||migrationMode==="component_flow"||migrationMode==="component_recency"||migrationMode==="scb_risk_flow")?grossOutMigration:null,
        migrationMode,
        migrationWindow,
        cohortTimingMode,
        fertilityScenario,
        scenarioEffect:sfx.total,scenarioDetail:sfx,change:total-prev,
        populationByAgeSex:snapshot()
      });
    }
    return results;
  }

  function aggregatePopulationByAgeSex(parts){
    if(!parts.length || !parts.every(r=>Array.isArray(r.populationByAgeSex))) return undefined;
    const totals=new Map();
    for(const r of parts){
      for(const cell of r.populationByAgeSex){
        const k=key(cell.sex,+cell.age);
        totals.set(k,n(totals.get(k))+n(cell.value));
      }
    }
    const out=[];
    for(const sex of ["K","M"]){
      for(let age=0;age<=MAX_AGE;age++){
        out.push({sex,age,value:n(totals.get(key(sex,age)))});
      }
    }
    return out;
  }

  function aggregateScenarioDetails(parts){
    const details=parts.map(r=>r.scenarioDetail).filter(Boolean);
    if(!details.length) return undefined;
    const sumField=field=>details.reduce((s,d)=>s+n(d[field]),0);
    return {
      total:sumField("total"),
      housingExternal:sumField("housingExternal"),
      housingInternalNet:sumField("housingInternalNet"),
      jobExternal:sumField("jobExternal"),
      jobExternalDomestic:sumField("jobExternalDomestic"),
      jobExternalInternational:sumField("jobExternalInternational"),
      jobInternalNet:sumField("jobInternalNet"),
      overlapDeduction:sumField("overlapDeduction"),
      jobExternalProfileEffects:details.flatMap(d=>d.jobExternalProfileEffects||[]),
      aggregatedFromMunicipalities:true
    };
  }

  function simulate(data, options){
    const geo=options.geo;
    if(geo!=="FA_LULEA"){
      return simulateSingleGeo(data,options);
    }

    const fa=(data.geographies||[]).find(g=>g.code==="FA_LULEA");
    const members=(fa&&fa.members)||[];
    if(!members.length){
      throw new Error("Luleå FA saknar medlemskommuner i modelldatan.");
    }

    // The published FA forecast is deliberately additive: each year and every
    // component is the sum of the five municipal forecasts. FA-specific
    // calibrated profiles remain available as diagnostics but do not drive a
    // separate sixth forecast that could diverge from the municipal total.
    const memberRuns=members.map(code=>
      simulateSingleGeo(data,{...options,geo:code})
    );
    const length=memberRuns[0]?.length||0;
    if(!length || !memberRuns.every(rows=>rows.length===length)){
      throw new Error("Kommunprognoserna för Luleå FA har olika längd.");
    }

    const results=[];
    for(let i=0;i<length;i++){
      const parts=memberRuns.map(rows=>rows[i]);
      const population=parts.reduce((s,r)=>s+n(r.population),0);
      const prev=i>0?results[i-1].population:population;
      results.push({
        year:parts[0].year,
        population,
        births:parts.reduce((s,r)=>s+n(r.births),0),
        deaths:parts.reduce((s,r)=>s+n(r.deaths),0),
        netMigration:parts.reduce((s,r)=>s+n(r.netMigration),0),
        // Municipal gross flows include moves within the FA and must not be
        // presented as external FA gross migration.
        grossInMigration:null,
        grossOutMigration:null,
        migrationMode:options.migrationMode||"net",
        scenarioEffect:parts.reduce((s,r)=>s+n(r.scenarioEffect),0),
        scenarioDetail:aggregateScenarioDetails(parts),
        change:i===0?0:population-prev,
        populationByAgeSex:aggregatePopulationByAgeSex(parts)
      });
    }
    return results;
  }

  global.RAPSModel={riskFromEvents,ckmMaxRelativePct,ckmRiskBounds,identityTransition,selectWindow,mean,scenarioEffect,simulate};
})(window);
