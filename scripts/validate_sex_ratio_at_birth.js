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
const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'data','sex_ratio_at_birth_config.json'),'utf8'));

const checks={};
const male=Number(data.parameters?.sexRatioMaleAtBirth);
checks.productionMaleShareIs0515=Math.abs(male-0.515)<1e-12;
checks.sexSharesSumToOne=Math.abs(Number(cfg.maleShare)+Number(cfg.femaleShare)-1)<1e-12;
checks.sourceIsExplicit=String(data.parameters?.sexRatioMaleAtBirthSource||'').includes('0.515');
checks.localObservedShareDiagnosticVisible=Number.isFinite(Number(data.parameters?.observedMaleBirthShareFA2015_2024));

const baseYear=Number(data.meta?.baseYear||2025);
const options={
  geo:'2580',
  endYear:baseYear+1,
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
const alt=JSON.parse(JSON.stringify(data));
alt.parameters={...(alt.parameters||{}),sexRatioMaleAtBirth:0.5};
const altered=M.simulate(alt,options);
checks.totalBirthsInvariantToSexSplit=
  Math.abs(Number(baseline[1].births)-Number(altered[1].births))<1e-9;

// A one-year no-migration/no-mortality synthetic run isolates newborn allocation.
const synthetic={
  meta:{baseYear:2025},
  geographies:[{code:'2580'}],
  parameters:{sexRatioMaleAtBirth:0.515,defaultFertilityScenario:'raps2024'},
  populationBase:[
    {geo:'2580',year:2025,sex:'K',age:29,value:1000},
    {geo:'2580',year:2025,sex:'M',age:29,value:1000}
  ],
  fertilityRates:[
    {geo:'2580',year:2026,age:30,window:10,value:0.1}
  ],
  mortalityRisks:[],
  netMigration:[]
};
const sr=M.simulate(synthetic,{
  geo:'2580',endYear:2026,window:10,migrationWindow:10,
  fertMult:1,mortMult:1,migMult:1,cohortTimingMode:'event_age_aligned',
  scenarios:{housing:[],workplaces:[],overlapPct:0},includeDetail:true
});
const age0=sr[1].populationByAgeSex.filter(r=>r.age===0);
const m0=age0.find(r=>r.sex==='M')?.value||0;
const k0=age0.find(r=>r.sex==='K')?.value||0;
checks.syntheticNewbornSplitMatchesParameter=
  Math.abs(m0/(m0+k0)-0.515)<1e-12 &&
  Math.abs(k0/(m0+k0)-0.485)<1e-12;

const allPassed=Object.values(checks).every(Boolean);
const out={
  schemaVersion:'0.1.0',
  status:allPassed?'production_parameter_validated':'validation_failed',
  allPassed,checks,
  observedMaleBirthShareFA2015_2024:data.parameters?.observedMaleBirthShareFA2015_2024,
  note:'Regression audit of the fixed Raps newborn sex split; local observed share remains diagnostic only.'
};
const outPath=path.join(ROOT,'data','backtests','sex_ratio_at_birth_validation.json');
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n','utf8');
console.log(JSON.stringify(out,null,2));
if(!allPassed) process.exit(1);
