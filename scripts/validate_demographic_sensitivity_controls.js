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

const baseYear=Number(data.meta?.baseYear||2025);
const baseOptions={
  geo:'2580',endYear:baseYear+1,
  window:10,migrationWindow:10,
  cohortTimingMode:'event_age_aligned',
  scenarios:{housing:[],workplaces:[],overlapPct:0},
  includeDetail:false
};
const run=(fertMult,mortMult,migMult)=>M.simulate(data,{
  ...baseOptions,fertMult,mortMult,migMult
});
const neutral=run(1,1,1), explicitNeutral=run(1,1,1);
const noFert=run(0,1,1), noMort=run(1,0,1), noMig=run(1,1,0), doubleMig=run(1,1,2);

const n=neutral[1], f=noFert[1], d=noMort[1], m=noMig[1], m2=doubleMig[1];
const checks={};
checks.neutralControlsReproduceBaseline=JSON.stringify(neutral)===JSON.stringify(explicitNeutral);
checks.zeroFertilityGivesZeroBirths=Math.abs(Number(f.births||0))<1e-9;
checks.zeroMortalityGivesZeroDeaths=Math.abs(Number(d.deaths||0))<1e-9;
checks.zeroMigrationGivesZeroNetMigration=Math.abs(Number(m.netMigration||0))<1e-9;
checks.doubleMigrationDoublesNetContribution=
  Math.abs(Number(m2.netMigration||0)-2*Number(n.netMigration||0))<1e-7;
checks.modelDefaultsRemainNeutral=
  Number(data.parameters?.defaultMigrationWindow||10)===10 &&
  data.parameters?.defaultFertilityScenario==='raps2024';

const allPassed=Object.values(checks).every(Boolean);
const out={
  schemaVersion:'0.1.0',
  status:allPassed?'production_sensitivity_controls_validated':'validation_failed',
  allPassed,checks,
  note:'Regression of user sensitivity multipliers. Passing does not make non-neutral multiplier values baseline assumptions.'
};
const outPath=path.join(ROOT,'data','backtests','demographic_sensitivity_controls_validation.json');
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n','utf8');
console.log(JSON.stringify(out,null,2));
if(!allPassed) process.exit(1);
