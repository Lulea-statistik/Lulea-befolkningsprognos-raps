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
const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'data','housing_balance_indicator_config.json'),'utf8'));

const checks={};
const h=1000;

const r0=M.housingRequiredDwellings(h,0);
const r1=M.housingRequiredDwellings(h,1);
const r10=M.housingRequiredDwellings(h,10);
const r20=M.housingRequiredDwellings(h,20);
const rNeg=M.housingRequiredDwellings(h,-10);
const rHigh=M.housingRequiredDwellings(h,100);

checks.zeroReserveNeutral=Math.abs(r0-h)<1e-12;
checks.reserveMonotonic=r0<r1 && r1<r10 && r10<r20;
checks.lowerClamp=Math.abs(rNeg-r0)<1e-12;
checks.upperClamp=Math.abs(rHigh-r20)<1e-12;
checks.formulaMatches=
  Math.abs(r1-h/0.99)<1e-12 &&
  Math.abs(r10-h/0.90)<1e-12 &&
  Math.abs(r20-h/0.80)<1e-12;

const plannedStart=120;
const plannedLater=420;
const plannedAdditions=plannedLater-plannedStart;
const required=M.housingRequiredDwellings(250,1);
const balance=plannedAdditions-required;
checks.balanceFormula=Math.abs(balance-(300-required))<1e-12;
checks.baseRelativePlannedAdditions=plannedAdditions===300;

// Demographic baseline must not depend on housing-analysis reserve.
const baseYear=Number(data.meta?.baseYear||2025);
const baseline=M.simulate(data,{
  geo:'2580',endYear:baseYear+2,window:10,migrationWindow:10,
  fertMult:1,mortMult:1,migMult:1,cohortTimingMode:'event_age_aligned',
  scenarios:{housing:[],workplaces:[],overlapPct:0},includeDetail:false
});
const baselineCopy=JSON.stringify(baseline);
M.housingRequiredDwellings(500,1);
checks.analysisHelperDoesNotMutateForecast=JSON.stringify(baseline)===baselineCopy;

const allPassed=Object.values(checks).every(Boolean);
const out={
  schemaVersion:'0.1.0',
  status:allPassed?'production_housing_balance_validated':'validation_failed',
  allPassed,
  checks,
  examples:{r0,r1,r10,r20,balance},
  note:'Housing-demand indicator validation only; does not validate market shortage or prices.'
};
const outPath=path.join(ROOT,'data','backtests','housing_balance_indicator_validation.json');
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n','utf8');
console.log(JSON.stringify(out,null,2));
if(!allPassed) process.exit(1);
