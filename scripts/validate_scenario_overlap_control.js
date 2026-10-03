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
const tol=1e-9;

const housing={
  active:true,year:baseYear+1,municipality:'2580',
  dwellings:100,completionPct:100,occupancyPct:100,
  personsMode:'manual',personsPerDwelling:2,
  externalSharePct:100,internalSharePct:0,phaseYears:1
};
const workplace={
  active:true,year:baseYear+1,municipality:'2580',
  jobs:100,realizationPct:100,allocationMode:'manual',
  moveSharePct:100,personsPerJob:1,
  spinOffJobsPerDirectJob:0,
  internationalRecruitmentSharePct:0,
  hostResidencePct:100,internalSharePct:0,phaseYears:1,
  ageProfileMode:'population'
};

function effect(pct,withScenarios=true){
  return M.scenarioEffect(data,{scenarios:{
    housing:withScenarios?[housing]:[],
    workplaces:withScenarios?[workplace]:[],
    overlapPct:pct
  }},baseYear+1,'2580');
}

const e0=effect(0), e25=effect(25), e100=effect(100), eNeg=effect(-50), eHigh=effect(500);
const checks={};

checks.zeroPctZeroDeduction=Math.abs(e0.overlapDeduction)<tol;
checks.fullPctDeductsMinComponent=
  Math.abs(e100.overlapDeduction-Math.min(e100.housingExternal,e100.jobExternal))<tol;
checks.clampsBelowZero=Math.abs(eNeg.overlapDeduction-e0.overlapDeduction)<tol;
checks.clampsAboveHundred=Math.abs(eHigh.overlapDeduction-e100.overlapDeduction)<tol;
checks.monotonicDeduction=
  e0.overlapDeduction<=e25.overlapDeduction+tol &&
  e25.overlapDeduction<=e100.overlapDeduction+tol;
checks.totalFormula=
  Math.abs(e25.total-(
    e25.housingExternal+e25.housingInternalNet+
    e25.jobExternal+e25.jobInternalNet-e25.overlapDeduction
  ))<tol;
const none=effect(100,false);
checks.noScenarioNoBaselineEffect=
  Math.abs(none.total)<tol && Math.abs(none.overlapDeduction)<tol;

const allPassed=Object.values(checks).every(Boolean);
const out={
  schemaVersion:'0.1.0',
  status:allPassed?'production_control_validated':'validation_failed',
  allPassed,checks,
  examples:{
    zero:e0.overlapDeduction,
    twentyFive:e25.overlapDeduction,
    hundred:e100.overlapDeduction
  },
  note:'Structural validation of the scenario double-count control; does not estimate the correct overlap percentage.'
};
const outPath=path.join(ROOT,'data','backtests','scenario_overlap_control_validation.json');
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n','utf8');
console.log(JSON.stringify(out,null,2));
if(!allPassed) process.exit(1);
