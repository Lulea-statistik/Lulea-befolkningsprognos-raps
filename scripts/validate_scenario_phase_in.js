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

const start=Number(data.meta?.baseYear||2025)+1;
const tol=1e-9;

function housing(phaseYears){
  return {
    active:true,
    year:start,
    municipality:'2580',
    dwellings:100,
    completionPct:100,
    occupancyPct:100,
    personsMode:'manual',
    personsPerDwelling:2,
    externalSharePct:100,
    internalSharePct:0,
    phaseYears
  };
}
function workplace(phaseYears){
  return {
    active:true,
    year:start,
    municipality:'2580',
    jobs:100,
    realizationPct:100,
    allocationMode:'manual',
    moveSharePct:100,
    personsPerJob:2,
    spinOffJobsPerDirectJob:0,
    internationalRecruitmentSharePct:0,
    internalSharePct:0,
    hostResidencePct:100,
    phaseYears,
    ageProfileMode:'population'
  };
}
function effects(kind,phaseYears){
  const scenarios={
    housing:kind==='housing'?[housing(phaseYears)]:[],
    workplaces:kind==='workplace'?[workplace(phaseYears)]:[],
    overlapPct:0
  };
  const out=[];
  for(let year=start-1;year<=start+Math.max(6,phaseYears+2);year++){
    out.push({
      year,
      ...M.scenarioEffect(data,{scenarios},year,'FA_LULEA')
    });
  }
  return out;
}

const h4=effects('housing',4);
const w4=effects('workplace',4);
const h1=effects('housing',1);
const h0=effects('housing',0);

const inWindow=(rows,n,field)=>rows
  .filter(r=>r.year>=start && r.year<start+n)
  .map(r=>Number(r[field]||0));

const checks={};

checks.zeroBeforeStart=
  Math.abs(h4.find(r=>r.year===start-1).total)<tol &&
  Math.abs(w4.find(r=>r.year===start-1).total)<tol;

checks.zeroAfterPhase=
  Math.abs(h4.find(r=>r.year===start+4).total)<tol &&
  Math.abs(w4.find(r=>r.year===start+4).total)<tol;

const hAnnual=inWindow(h4,4,'housingExternal');
const wAnnual=inWindow(w4,4,'jobExternal');

checks.equalHousingAnnualIncrements=
  hAnnual.length===4 && hAnnual.every(v=>Math.abs(v-hAnnual[0])<tol);

checks.equalWorkplaceAnnualIncrements=
  wAnnual.length===4 && wAnnual.every(v=>Math.abs(v-wAnnual[0])<tol);

checks.housingCumulativePreserved=
  Math.abs(hAnnual.reduce((a,b)=>a+b,0)-200)<tol;

checks.workplaceCumulativePreserved=
  Math.abs(wAnnual.reduce((a,b)=>a+b,0)-200)<tol;

const h1Total=inWindow(h1,1,'housingExternal').reduce((a,b)=>a+b,0);
const h4Total=hAnnual.reduce((a,b)=>a+b,0);
checks.phaseYearsChangesTimingNotMagnitude=Math.abs(h1Total-h4Total)<tol;

const h0Start=h0.find(r=>r.year===start);
const h0After=h0.find(r=>r.year===start+1);
checks.zeroPhaseYearsFallsBackToOneYear=
  Math.abs(Number(h0Start.housingExternal||0)-200)<tol &&
  Math.abs(Number(h0After.housingExternal||0))<tol;

const allPassed=Object.values(checks).every(Boolean);
const result={
  schemaVersion:'0.1.0',
  status:allPassed?'production_scenario_phase_validated':'validation_failed',
  allPassed,
  checks,
  examples:{
    housingPhase4Annual:hAnnual,
    workplacePhase4Annual:wAnnual,
    housingPhase1Total:h1Total,
    housingPhase4Total:h4Total
  },
  note:'Deterministic validation that phase-in changes scenario timing only, not cumulative magnitude.'
};

const outPath=path.join(ROOT,'data','backtests','scenario_phase_in_validation.json');
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify(result,null,2));
if(!allPassed) process.exit(1);
