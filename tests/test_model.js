const fs=require('fs'), vm=require('vm');
global.window={};
vm.runInThisContext(fs.readFileSync(__dirname+'/../js/model.js','utf8'));
const M=window.RAPSModel;
function assert(cond,msg){if(!cond)throw new Error(msg)}

assert(Math.abs(M.riskFromEvents(10,100)-(1-Math.exp(-0.1)))<1e-12,'risk formula');
const b=M.ckmRiskBounds(10,100,3);
assert(b.low<=b.base&&b.base<=b.high,'ckm bounds');
const I=M.identityTransition(3);
assert(I[0][0]===1&&I[0][1]===0&&I[2][2]===1,'identity qutb');

const demoData={
  meta:{baseYear:2025},
  geographies:[
    {code:'FA_LULEA',members:['2580','2582','2581','2560','2514']},
    {code:'2580'},{code:'2582'},{code:'2581'},{code:'2560'},{code:'2514'}
  ],
  populationBase:[
    ...['2580','2582','2581','2560','2514'].map((geo,i)=>({geo,year:2025,sex:'K',age:30,value:[80000,28000,42000,8000,15000][i]})),
    ...['2580','2582','2581','2560','2514'].map((geo,i)=>({geo,year:2025,sex:'M',age:30,value:0}))
  ]
};
const scenario={housing:[{active:true,year:2030,municipality:'2580',dwellings:1000,completionPct:100,occupancyPct:100,personsPerDwelling:2,externalSharePct:50,internalSharePct:25,phaseYears:1}],workplaces:[],overlapPct:0};
const fa=M.scenarioEffect(demoData,{scenarios:scenario},2030,'FA_LULEA').total;
const sum=['2580','2582','2581','2560','2514'].reduce((s,g)=>s+M.scenarioEffect(demoData,{scenarios:scenario},2030,g).total,0);
assert(Math.abs(fa-1000)<1e-9,'FA housing external effect');
assert(Math.abs(sum-fa)<1e-9,'internal housing moves net to zero across municipalities');


const commutingScenario={
  housing:[],
  workplaces:[{
    active:true,
    year:2030,
    municipality:'2580',
    jobs:1000,
    realizationPct:100,
    allocationMode:'commuting',
    useObservedCommuting:true,
    commutingYear:2024,
    commutingShares:{
      '2580':80,
      '2582':10,
      '2581':5,
      '2560':2,
      '2514':1,
      OUTSIDE_FA:2
    },
    moveSharePct:50,
    personsPerJob:2,
    internalSharePct:20,
    phaseYears:1
  }],
  overlapPct:0
};
const faJobs=M.scenarioEffect(demoData,{scenarios:commutingScenario},2030,'FA_LULEA');
assert(Math.abs(faJobs.jobExternal-20)<1e-9,'observed commuting external job effect');
assert(Math.abs(faJobs.jobInternalNet)<1e-9,'FA internal commuting moves net to zero');
const municipalJobs=['2580','2582','2581','2560','2514']
  .map(g=>M.scenarioEffect(demoData,{scenarios:commutingScenario},2030,g));
const sumJobs=municipalJobs.reduce((s,r)=>s+r.total,0);
assert(Math.abs(sumJobs-faJobs.total)<1e-9,'observed commuting workplace effects balance across municipalities');
assert(Math.abs(faJobs.total-20)<1e-9,'only outside-FA movers add population to FA');


const profiledScenarioData={
  meta:{baseYear:2025},
  calibration:{defaultYears:10},
  geographies:[
    {code:'FA_LULEA',members:['2580','2582','2581','2560','2514']},
    {code:'2580'},{code:'2582'},{code:'2581'},{code:'2560'},{code:'2514'}
  ],
  parameters:{sexRatioMaleAtBirth:0.515},
  populationBase:[
    {geo:'2580',year:2025,sex:'K',age:20,value:1000},
    {geo:'2580',year:2025,sex:'M',age:20,value:1000}
  ],
  fertilityRates:[],
  mortalityRisks:[],
  netMigration:[],
  scenarioMigrationProfiles:[
    {geo:'2580',window:10,profile:'job_family',sex:'K',age:30,share:0.75},
    {geo:'2580',window:10,profile:'job_family',sex:'M',age:30,share:0.25}
  ]
};
const profiledScenario={
  housing:[],
  workplaces:[{
    active:true,year:2026,municipality:'2580',jobs:10,realizationPct:100,
    useObservedCommuting:true,
    commutingShares:{'2580':80,'2582':0,'2581':0,'2560':0,'2514':0,OUTSIDE_FA:20},
    moveSharePct:100,personsPerJob:1,internalSharePct:0,phaseYears:1,
    ageProfileMode:'job_family'
  }],
  overlapPct:0
};
const profiled=M.simulate(profiledScenarioData,{
  geo:'2580',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:10,
  scenarios:profiledScenario,includeDetail:true
})[1];
const k30=profiled.populationByAgeSex.find(r=>r.sex==='K'&&r.age===30).value;
const m30=profiled.populationByAgeSex.find(r=>r.sex==='M'&&r.age===30).value;
assert(Math.abs(k30-1.5)<1e-9,'job profile adds external movers to female age cell');
assert(Math.abs(m30-0.5)<1e-9,'job profile adds external movers to male age cell');
assert(Math.abs(k30+m30-2)<1e-9,'profiled job movers preserve total scenario effect');


const householdScenarioData={
  meta:{baseYear:2025},
  calibration:{defaultYears:10},
  geographies:[
    {code:'FA_LULEA',members:['2580','2582','2581','2560','2514']},
    {code:'2580'},{code:'2582'},{code:'2581'},{code:'2560'},{code:'2514'}
  ],
  parameters:{sexRatioMaleAtBirth:0.515},
  populationBase:[
    {geo:'2580',year:2025,sex:'K',age:20,value:1000},
    {geo:'2580',year:2025,sex:'M',age:20,value:1000}
  ],
  fertilityRates:[],
  mortalityRisks:[],
  netMigration:[],
  scenarioMigrationProfiles:[
    {geo:'2580',window:10,profile:'worker_hybrid',sex:'K',age:30,share:1},
    {geo:'2580',window:10,profile:'family_companion',sex:'M',age:5,share:1}
  ]
};
const householdScenario={
  housing:[],
  workplaces:[{
    active:true,year:2026,municipality:'2580',jobs:10,realizationPct:100,
    useObservedCommuting:true,
    commutingShares:{'2580':80,'2582':0,'2581':0,'2560':0,'2514':0,OUTSIDE_FA:20},
    moveSharePct:100,personsPerJob:1.5,internalSharePct:0,phaseYears:1,
    ageProfileMode:'worker_household'
  }],
  overlapPct:0
};
const household=M.simulate(householdScenarioData,{
  geo:'2580',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:10,
  scenarios:householdScenario,includeDetail:true
})[1];
const worker30=household.populationByAgeSex.find(r=>r.sex==='K'&&r.age===30).value;
const companion5=household.populationByAgeSex.find(r=>r.sex==='M'&&r.age===5).value;
assert(Math.abs(worker30-2)<1e-9,'one worker per moving job uses worker profile');
assert(Math.abs(companion5-1)<1e-9,'persons above one per job use household-companion profile');
assert(Math.abs(worker30+companion5-3)<1e-9,'worker plus household profiles preserve total people per job');

const windowData={
  meta:{baseYear:2025},
  calibration:{defaultYears:10},
  geographies:[{code:'2580'}],
  parameters:{sexRatioMaleAtBirth:0.5},
  populationBase:[
    {geo:'2580',year:2025,sex:'K',age:30,value:1000},
    {geo:'2580',year:2025,sex:'M',age:30,value:1000}
  ],
  fertilityRates:[
    {geo:'2580',window:6,age:31,value:0.10},
    {geo:'2580',window:10,age:31,value:0.05}
  ],
  mortalityRisks:[],
  netMigration:[]
};
const w6=M.simulate(windowData,{geo:'2580',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:6,scenarios:{}})[1];
const w10=M.simulate(windowData,{geo:'2580',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:10,scenarios:{}})[1];
assert(w6.births>w10.births,'calibration window changes projected births');


const faAdditiveData={
  meta:{baseYear:2025},
  calibration:{defaultYears:10},
  geographies:[
    {code:'FA_LULEA',members:['2580','2582','2581','2560','2514']},
    {code:'2580'},{code:'2582'},{code:'2581'},{code:'2560'},{code:'2514'}
  ],
  parameters:{sexRatioMaleAtBirth:0.515},
  populationBase:[
    ...['2580','2582','2581','2560','2514'].map((geo,i)=>({geo,year:2025,sex:'K',age:30,value:100+i*10})),
    {geo:'FA_LULEA',year:2025,sex:'K',age:30,value:999}
  ],
  fertilityRates:[
    ...['2580','2582','2581','2560','2514'].map((geo,i)=>({geo,window:10,age:30,value:0.01*(i+1)})),
    {geo:'FA_LULEA',window:10,age:30,value:0.99}
  ],
  mortalityRisks:[],
  netMigration:[]
};
const faAdditiveScenario={
  housing:[{
    active:true,year:2026,municipality:'2580',dwellings:100,completionPct:100,
    occupancyPct:100,personsPerDwelling:2,externalSharePct:50,
    internalSharePct:25,phaseYears:1
  }],
  workplaces:[],
  overlapPct:0
};
const additiveMembers=['2580','2582','2581','2560','2514'].map(geo=>
  M.simulate(faAdditiveData,{
    geo,endYear:2026,fertMult:1,mortMult:1,migMult:1,window:10,
    scenarios:faAdditiveScenario,includeDetail:true
  })
);
const additiveFA=M.simulate(faAdditiveData,{
  geo:'FA_LULEA',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:10,
  scenarios:faAdditiveScenario,includeDetail:true
});
for(let i=0;i<additiveFA.length;i++){
  const sumPopulation=additiveMembers.reduce((s,rows)=>s+rows[i].population,0);
  const sumBirths=additiveMembers.reduce((s,rows)=>s+rows[i].births,0);
  const sumDeaths=additiveMembers.reduce((s,rows)=>s+rows[i].deaths,0);
  const sumMigration=additiveMembers.reduce((s,rows)=>s+rows[i].netMigration,0);
  const sumScenario=additiveMembers.reduce((s,rows)=>s+rows[i].scenarioEffect,0);
  assert(Math.abs(additiveFA[i].population-sumPopulation)<1e-9,'FA population is sum of municipalities');
  assert(Math.abs(additiveFA[i].births-sumBirths)<1e-9,'FA births are sum of municipalities');
  assert(Math.abs(additiveFA[i].deaths-sumDeaths)<1e-9,'FA deaths are sum of municipalities');
  assert(Math.abs(additiveFA[i].netMigration-sumMigration)<1e-9,'FA migration is sum of municipalities');
  assert(Math.abs(additiveFA[i].scenarioEffect-sumScenario)<1e-9,'FA scenario effect is sum of municipalities');
  const faDetailTotal=additiveFA[i].populationByAgeSex.reduce((s,r)=>s+r.value,0);
  assert(Math.abs(faDetailTotal-additiveFA[i].population)<1e-9,'FA age-sex detail preserves total population');
}
assert(Math.abs(additiveFA[0].population-600)<1e-9,'FA base ignores divergent standalone FA row');
assert(Math.abs(additiveFA[1].births-19)<1e-9,'FA fertility follows municipal forecasts, not standalone FA fertility');


const grossFlowData={
  meta:{baseYear:2025},
  calibration:{defaultYears:10},
  geographies:[{code:'2580'}],
  parameters:{sexRatioMaleAtBirth:0.5},
  populationBase:[
    {geo:'2580',year:2025,sex:'K',age:30,value:1000}
  ],
  fertilityRates:[],
  mortalityRisks:[],
  netMigration:[
    {geo:'2580',window:10,year:'BASE',sex:'K',age:31,value:10}
  ],
  outMigrationRisks:[
    {geo:'2580',window:10,sex:'K',age:31,value:0.10}
  ],
  grossInMigration:[
    {geo:'2580',window:10,year:'BASE',sex:'K',age:31,value:50}
  ]
};
const netMode=M.simulate(grossFlowData,{
  geo:'2580',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:10,
  scenarios:{},includeDetail:true
})[1];
assert(Math.abs(netMode.population-1010)<1e-9,'default migration mode remains exogenous net migration');
assert(netMode.grossInMigration===null&&netMode.grossOutMigration===null,'default mode does not expose gross flows');

const grossMode=M.simulate(grossFlowData,{
  geo:'2580',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:10,
  migrationMode:'gross_flow',scenarios:{},includeDetail:true
})[1];
assert(Math.abs(grossMode.grossInMigration-50)<1e-9,'gross-flow candidate uses historical gross inflow');
assert(Math.abs(grossMode.grossOutMigration-100)<1e-9,'gross-flow candidate applies urisk to current population');
assert(Math.abs(grossMode.netMigration+50)<1e-9,'gross-flow candidate derives net migration from gross flows');
assert(Math.abs(grossMode.population-950)<1e-9,'gross-flow candidate updates population from gross inflow and outflow');


const timingData={
  meta:{baseYear:2025},
  calibration:{defaultYears:10},
  geographies:[{code:'2580'}],
  parameters:{sexRatioMaleAtBirth:0.5},
  populationBase:[
    {geo:'2580',year:2025,sex:'K',age:79,value:100},
    {geo:'2580',year:2025,sex:'K',age:30,value:100}
  ],
  mortalityRisks:[
    {geo:'2580',window:10,year:2026,sex:'K',age:79,value:0.10},
    {geo:'2580',window:10,year:2026,sex:'K',age:80,value:0.20},
    {geo:'2580',window:10,year:2026,sex:'K',age:0,value:0.20},
    {geo:'2580',window:10,year:2026,sex:'M',age:0,value:0.20}
  ],
  fertilityRates:[
    {geo:'2580',window:10,year:2026,age:31,value:0.10}
  ],
  netMigration:[]
};
const legacyTiming=M.simulate(timingData,{
  geo:'2580',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:10,
  cohortTimingMode:'legacy_start_age',scenarios:{},includeDetail:true
})[1];
const alignedTiming=M.simulate(timingData,{
  geo:'2580',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:10,
  cohortTimingMode:'event_age_aligned',scenarios:{},includeDetail:true
})[1];
const defaultTiming=M.simulate(timingData,{
  geo:'2580',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:10,
  scenarios:{},includeDetail:true
})[1];
assert(Math.abs(legacyTiming.deaths-10)<1e-9,'legacy timing applies start-age mortality before ageing');
assert(Math.abs(legacyTiming.births)<1e-9,'legacy timing uses maternal start age');
assert(Math.abs(alignedTiming.births-10)<1e-9,'event-age timing uses maternal age in forecast year');
assert(Math.abs(alignedTiming.deaths-22)<1e-9,'event-age timing uses age-80 risk and includes newborn deaths');
assert(Math.abs(alignedTiming.population-188)<1e-9,'event-age timing preserves cohort accounting after births and deaths');
assert(alignedTiming.cohortTimingMode==='event_age_aligned','timing mode is exposed in results');
assert(defaultTiming.cohortTimingMode==='event_age_aligned','event-age timing is the production default');
assert(Math.abs(defaultTiming.population-alignedTiming.population)<1e-9,'default timing matches event-age aligned result');

console.log('OK: model core, scenarios, additive FA, gross-flow migration and production event-age timing tests passed');
