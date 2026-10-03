#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const vm=require('vm');

const ROOT=path.resolve(__dirname,'..');
global.window={};
vm.runInThisContext(fs.readFileSync(path.join(ROOT,'js','model.js'),'utf8'));
const M=window.RAPSModel;
const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'data','housing_scenario_config.json'),'utf8'));

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

function scenarioFor(preset){
  return {
    housing:[{
      active:true,
      year:2030,
      municipality:'2580',
      dwellingType:'flerbostadshus',
      tenure:'hyresrätt',
      size:'2 rum',
      dwellings:1000,
      completionPct:preset.completionPct,
      occupancyPct:preset.occupancyPct,
      personsMode:'manual',
      personsPerDwelling:2,
      externalSharePct:preset.externalSharePct,
      internalSharePct:preset.internalSharePct,
      phaseYears:preset.phaseYears
    }],
    workplaces:[],
    overlapPct:0
  };
}

const output={};
for(const key of ['low','reference','high']){
  const scenario=scenarioFor(cfg.sensitivityPresets[key]);
  const fa=M.scenarioEffect(demoData,{scenarios:scenario},2030,'FA_LULEA');
  const municipal=members.map(geo=>({
    geo,
    ...M.scenarioEffect(demoData,{scenarios:scenario},2030,geo)
  }));
  output[key]={fa,municipal};
}

const tol=1e-9;
const checks={};

checks.externalEffectMonotonic=
  output.low.fa.housingExternal <= output.reference.fa.housingExternal + tol &&
  output.reference.fa.housingExternal <= output.high.fa.housingExternal + tol;

checks.internalMovesNetZeroAtFA=['low','reference','high'].every(
  key=>Math.abs(output[key].fa.housingInternalNet)<tol
);

checks.municipalEffectsSumToFA=['low','reference','high'].every(key=>{
  const sum=output[key].municipal.reduce((s,r)=>s+r.total,0);
  return Math.abs(sum-output[key].fa.total)<tol;
});

checks.faContainsOnlyExternalHousingGrowth=['low','reference','high'].every(key=>
  Math.abs(output[key].fa.total-output[key].fa.housingExternal)<tol
);

checks.referenceFormula=(()=>{
  const p=cfg.sensitivityPresets.reference;
  const expected=
    1000*(p.completionPct/100)*(p.occupancyPct/100)*2*(p.externalSharePct/100);
  return Math.abs(output.reference.fa.housingExternal-expected)<tol;
})();

checks.baselineExcluded=cfg.baselineExcluded===true;
checks.autoModePreferred=['low','reference','high'].every(
  key=>cfg.sensitivityPresets[key].personsMode==='auto'
);

const allPassed=Object.values(checks).every(Boolean);
const result={
  schemaVersion:'0.1.0',
  status:allPassed?'engine_regression_passed':'engine_regression_failed',
  allPassed,
  checks,
  outputs:Object.fromEntries(
    Object.entries(output).map(([key,v])=>[key,{
      fa:{
        total:v.fa.total,
        housingExternal:v.fa.housingExternal,
        housingInternalNet:v.fa.housingInternalNet
      }
    }])
  ),
  note:'Deterministic regression of housing scenario mechanics; not an empirical forecast validation.'
};

const out=path.join(ROOT,'data','backtests','housing_scenario_validation.json');
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result,null,2));
if(!allPassed) process.exit(1);
