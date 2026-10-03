#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const vm=require('vm');

const ROOT=path.resolve(__dirname,'..');
global.window={};
vm.runInThisContext(fs.readFileSync(path.join(ROOT,'js','model.js'),'utf8'));
const M=window.RAPSModel;
const cfg=JSON.parse(
  fs.readFileSync(path.join(ROOT,'data','industrial_workforce_scenario_config.json'),'utf8')
);

const members=['2580','2582','2581','2560','2514'];
const demoData={
  meta:{baseYear:2025},
  geographies:[
    {code:'FA_LULEA',members},
    ...members.map(code=>({code}))
  ],
  populationBase:[
    ...members.map((geo,i)=>({geo,year:2025,sex:'K',age:30,value:1000+i*100})),
    ...members.map(geo=>({geo,year:2025,sex:'M',age:30,value:1000}))
  ]
};

// Synthetic, fixed commuting structure used only to regression-test mechanics.
// 20% of jobs are held by people outside the FA.
const commutingShares={
  '2580':55,
  '2582':10,
  '2581':8,
  '2560':4,
  '2514':3,
  OUTSIDE_FA:20
};

function scenarioFor(preset){
  return {
    housing:[],
    workplaces:[{
      active:true,
      year:2030,
      municipality:'2580',
      jobs:cfg.bodenReferenceJobs.initialPlantJobs,
      realizationPct:preset.realizationPct,
      allocationMode:preset.allocationMode,
      useObservedCommuting:true,
      commutingYear:2024,
      commutingShares,
      moveSharePct:preset.moveSharePct,
      personsPerJob:preset.personsPerJob,
      internationalRecruitmentSharePct:preset.internationalRecruitmentSharePct,
      hostResidencePct:60,
      internalSharePct:10,
      phaseYears:preset.phaseYears,
      ageProfileMode:preset.ageProfileMode
    }],
    overlapPct:0
  };
}

const output={};
for(const key of ['low','reference','high']){
  const preset=cfg.sensitivityPresets[key];
  const scenario=scenarioFor(preset);
  const fa=M.scenarioEffect(demoData,{scenarios:scenario},2030,'FA_LULEA');
  const municipality=members.map(geo=>({
    geo,
    ...M.scenarioEffect(demoData,{scenarios:scenario},2030,geo)
  }));
  output[key]={preset,fa,municipality};
}

const tol=1e-9;
const checks={};
checks.externalEffectMonotonic=
  output.low.fa.jobExternal <= output.reference.fa.jobExternal + tol &&
  output.reference.fa.jobExternal <= output.high.fa.jobExternal + tol;

checks.totalEffectMonotonic=
  output.low.fa.total <= output.reference.fa.total + tol &&
  output.reference.fa.total <= output.high.fa.total + tol;

checks.sourceSplitPreservesExternalTotal=['low','reference','high'].every(key=>{
  const x=output[key].fa;
  return Math.abs(
    x.jobExternalDomestic+x.jobExternalInternational-x.jobExternal
  ) < tol;
});

checks.faInternalMovesNetZero=['low','reference','high'].every(
  key=>Math.abs(output[key].fa.jobInternalNet) < tol
);

checks.municipalEffectsSumToFA=['low','reference','high'].every(key=>{
  const sum=output[key].municipality.reduce((s,r)=>s+r.total,0);
  return Math.abs(sum-output[key].fa.total) < tol;
});

checks.internationalShareChangesCompositionNotTotal=(()=>{
  const base=cfg.sensitivityPresets.reference;
  const make=(share)=>{
    const p={...base,internationalRecruitmentSharePct:share};
    return M.scenarioEffect(
      demoData,{scenarios:scenarioFor(p)},2030,'FA_LULEA'
    );
  };
  const a=make(0), b=make(100);
  return Math.abs(a.jobExternal-b.jobExternal)<tol &&
    Math.abs(a.jobExternalInternational)<tol &&
    Math.abs(b.jobExternalDomestic)<tol;
})();

const allPassed=Object.values(checks).every(Boolean);
const result={
  schemaVersion:'0.1.0',
  status:allPassed?'engine_regression_passed':'engine_regression_failed',
  allPassed,
  checks,
  syntheticCommutingShares:commutingShares,
  jobCount:cfg.bodenReferenceJobs.initialPlantJobs,
  presets:Object.fromEntries(
    Object.entries(output).map(([k,v])=>[k,{
      fa:{
        total:v.fa.total,
        jobExternal:v.fa.jobExternal,
        jobExternalDomestic:v.fa.jobExternalDomestic,
        jobExternalInternational:v.fa.jobExternalInternational,
        jobInternalNet:v.fa.jobInternalNet
      }
    }])
  ),
  note:'Deterministic engine regression for scenario mechanics only; not an empirical forecast validation.'
};
const out=path.join(ROOT,'data','backtests','industrial_workforce_scenario_engine_validation.json');
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result,null,2));
if(!allPassed) process.exit(1);
