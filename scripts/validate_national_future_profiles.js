#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(__dirname,'..');
const data=JSON.parse(fs.readFileSync(path.join(ROOT,'data','model_data.json'),'utf8'));
const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'data','national_future_profiles_config.json'),'utf8'));

const baseYear=Number(data.meta?.baseYear||2025);
const years=Array.from({length:10},(_,i)=>baseYear+i+1);
const geos=['2580','2582','2581','2560','2514'];
const checks={};

checks.defaultFertilityScenarioIsRaps2024=data.parameters?.defaultFertilityScenario==='raps2024';
checks.futureProfileModeExplicit=/SCB 2024 annual national profiles/.test(String(data.parameters?.futureNationalProfileMode||''));

let fertComplete=true,mortComplete=true,finiteNonnegative=true;
for(const geo of geos){
  for(const year of years){
    for(let age=15;age<=49;age++){
      const r=(data.fertilityRates||[]).find(x=>
        x.geo===geo&&Number(x.year)===year&&Number(x.age)===age&&Number(x.window)===10
      );
      fertComplete=fertComplete&&!!r;
      if(r) finiteNonnegative=finiteNonnegative&&Number.isFinite(Number(r.value))&&Number(r.value)>=0;
    }
    for(const sex of ['K','M']){
      for(let age=0;age<=100;age++){
        const r=(data.mortalityRisks||[]).find(x=>
          x.geo===geo&&Number(x.year)===year&&x.sex===sex&&Number(x.age)===age&&Number(x.window)===10
        );
        mortComplete=mortComplete&&!!r;
        if(r) finiteNonnegative=finiteNonnegative&&Number.isFinite(Number(r.value))&&Number(r.value)>=0;
      }
    }
  }
}
checks.completeTenYearFertilityCoverage=fertComplete;
checks.completeTenYearMortalityCoverage=mortComplete;
checks.allFutureRatesFiniteNonnegative=finiteNonnegative;

const hasScb2026=(data.fertilityScenarios||[]).some(x=>x.id==='scb2026');
let scb2026Coverage=true;
if(hasScb2026){
  for(const geo of geos){
    for(const year of years){
      for(let age=15;age<=49;age++){
        const r=(data.fertilityScenarioRates||[]).find(x=>
          x.scenario==='scb2026'&&x.geo===geo&&Number(x.year)===year&&
          Number(x.age)===age&&Number(x.window)===10
        );
        scb2026Coverage=scb2026Coverage&&!!r&&Number.isFinite(Number(r.value))&&Number(r.value)>=0;
      }
    }
  }
}
checks.scb2026SensitivityCoverage=hasScb2026?scb2026Coverage:true;
checks.scb2026DoesNotReplaceBaseline=(
  !hasScb2026 ||
  ((data.fertilityScenarios||[]).find(x=>x.id==='scb2026')?.isBaseline===false &&
   data.parameters?.defaultFertilityScenario==='raps2024')
);

const allPassed=Object.values(checks).every(Boolean);
const out={
  schemaVersion:'0.1.0',
  status:allPassed?'production_inputs_validated':'validation_failed',
  allPassed,checks,
  baseYear,validatedYears:years,
  note:'Coverage/reproducibility gate for national future assumptions inside the supported ten-year UI horizon.'
};
const outPath=path.join(ROOT,'data','backtests','national_future_profiles_validation.json');
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n','utf8');
console.log(JSON.stringify(out,null,2));
if(!allPassed) process.exit(1);
