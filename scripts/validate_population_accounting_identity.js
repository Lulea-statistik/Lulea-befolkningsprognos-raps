#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const vm=require('vm');

const ROOT=path.resolve(__dirname,'..');
global.window={};
vm.runInThisContext(fs.readFileSync(path.join(ROOT,'js','model.js'),'utf8'));
const M=window.RAPSModel;
const data=JSON.parse(fs.readFileSync(path.join(ROOT,'data','model_data.json'),'utf8'));

const geos=['2580','2582','2581','2560','2514','FA_LULEA'];
const baseYear=Number(data.meta?.baseYear||2025);
const endYear=baseYear+10;
const tol=1e-7;

const baselineScenarios={housing:[],workplaces:[],overlapPct:0};
const activeScenarios={
  housing:[{
    active:true,year:baseYear+2,municipality:'2580',
    dwellings:120,completionPct:90,occupancyPct:95,
    personsMode:'manual',personsPerDwelling:1.8,
    externalSharePct:50,internalSharePct:20,phaseYears:3
  }],
  workplaces:[{
    active:true,year:baseYear+3,municipality:'2580',
    jobs:100,realizationPct:80,allocationMode:'manual',
    moveSharePct:40,personsPerJob:1.5,spinOffJobsPerDirectJob:0.5,
    internationalRecruitmentSharePct:20,internalSharePct:10,
    hostResidencePct:60,phaseYears:4,ageProfileMode:'population'
  }],
  overlapPct:25
};

function run(geo,scenarios){
  return M.simulate(data,{
    geo,endYear,window:10,migrationWindow:10,
    fertMult:1,mortMult:1,migMult:1,
    cohortTimingMode:'event_age_aligned',
    scenarios,includeDetail:false
  });
}

const checks={};
let maxIdentityResidual=0;
let maxPopulationResidual=0;
let baselineScenarioZero=true;
let allYearsCovered=true;

for(const mode of [
  ['baseline',baselineScenarios],
  ['scenario',activeScenarios]
]){
  const [name,scenarios]=mode;
  for(const geo of geos){
    const rows=run(geo,scenarios);
    allYearsCovered=allYearsCovered && rows.length===11 &&
      rows[0].year===baseYear && rows.at(-1).year===endYear;
    for(let i=1;i<rows.length;i++){
      const r=rows[i], prev=rows[i-1];
      const rhs=Number(r.births||0)-Number(r.deaths||0)+
        Number(r.netMigration||0)+Number(r.scenarioEffect||0);
      const identityResidual=Math.abs(Number(r.change||0)-rhs);
      const popResidual=Math.abs(Number(r.population||0)-(
        Number(prev.population||0)+Number(r.change||0)
      ));
      maxIdentityResidual=Math.max(maxIdentityResidual,identityResidual);
      maxPopulationResidual=Math.max(maxPopulationResidual,popResidual);
      if(name==='baseline' && Math.abs(Number(r.scenarioEffect||0))>tol){
        baselineScenarioZero=false;
      }
    }
  }
}

checks.annualChangeIdentity=maxIdentityResidual<=tol;
checks.populationReconcilesToPriorYear=maxPopulationResidual<=tol;
checks.baselineScenarioEffectZero=baselineScenarioZero;
checks.fullTenYearHorizonCovered=allYearsCovered;

const allPassed=Object.values(checks).every(Boolean);
const result={
  schemaVersion:'0.1.0',
  status:allPassed?'production_accounting_validated':'validation_failed',
  allPassed,
  checks,
  maxIdentityResidual,
  maxPopulationResidual,
  note:'Hard accounting invariant for baseline and scenario forecasts across all municipalities and Lulea FA.'
};
const outPath=path.join(ROOT,'data','backtests','population_accounting_identity_validation.json');
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result,null,2));
if(!allPassed) process.exit(1);
