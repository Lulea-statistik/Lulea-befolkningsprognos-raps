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
const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'data','qutb_neutralization_config.json'),'utf8'));

const checks={};
checks.qutbModeIsIdentity=data.parameters?.qutbMode==='identity';

const size=5;
const I=M.identityTransition(size);
checks.identityMatrixShape=
  Array.isArray(I)&&I.length===size&&I.every(r=>Array.isArray(r)&&r.length===size);
checks.identityMatrixValues=I.every((r,i)=>r.every((v,j)=>v===(i===j?1:0)));
checks.identityRowsSumToOne=I.every(r=>Math.abs(r.reduce((a,b)=>a+b,0)-1)<1e-12);

const baseYear=Number(data.meta?.baseYear||2025);
const options={
  geo:'2580',
  endYear:baseYear+2,
  window:10,
  migrationWindow:10,
  fertMult:1,
  mortMult:1,
  migMult:1,
  cohortTimingMode:'event_age_aligned',
  scenarios:{housing:[],workplaces:[],overlapPct:0},
  includeDetail:false
};

const baseline=M.simulate(data,options);
const explicitIdentity=JSON.parse(JSON.stringify(data));
explicitIdentity.parameters={...(explicitIdentity.parameters||{}),qutbMode:'identity'};
explicitIdentity.qutbTransition=I;
const withIdentity=M.simulate(explicitIdentity,options);

function comparable(rows){
  return rows.map(r=>({
    year:r.year,
    population:r.population,
    births:r.births,
    deaths:r.deaths,
    netMigration:r.netMigration,
    change:r.change
  }));
}
checks.identityQutbHasZeroForecastEffect=
  JSON.stringify(comparable(baseline))===JSON.stringify(comparable(withIdentity));

const allPassed=Object.values(checks).every(Boolean);
const out={
  schemaVersion:'0.1.0',
  status:allPassed?'production_neutralization_validated':'validation_failed',
  allPassed,
  checks,
  productionMode:cfg.productionMode,
  note:'Level-4 readiness here validates an intentional no-effect qutb placeholder, not an empirical education-transition model.'
};
const outPath=path.join(ROOT,'data','backtests','qutb_neutralization_validation.json');
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n','utf8');
console.log(JSON.stringify(out,null,2));
if(!allPassed) process.exit(1);
