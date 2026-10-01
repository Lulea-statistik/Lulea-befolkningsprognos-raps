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
    {geo:'2580',window:6,age:30,value:0.10},
    {geo:'2580',window:10,age:30,value:0.05}
  ],
  mortalityRisks:[],
  netMigration:[]
};
const w6=M.simulate(windowData,{geo:'2580',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:6,scenarios:{}})[1];
const w10=M.simulate(windowData,{geo:'2580',endYear:2026,fertMult:1,mortMult:1,migMult:1,window:10,scenarios:{}})[1];
assert(w6.births>w10.births,'calibration window changes projected births');

console.log('OK: model core, housing/workplace scenario balance, commuting allocation and calibration-window tests passed');
