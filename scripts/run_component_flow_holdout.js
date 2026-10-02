#!/usr/bin/env node
'use strict';

const fs=require('fs');
const path=require('path');
const vm=require('vm');

const ROOT=path.resolve(__dirname,'..');
const WORKDIR=path.join(ROOT,'data','backtests','component_flow_holdout_work');

global.window={};
vm.runInThisContext(
  fs.readFileSync(path.join(ROOT,'js','model.js'),'utf8')
);
const M=window.RAPSModel;

const manifest=JSON.parse(
  fs.readFileSync(path.join(WORKDIR,'manifest.json'),'utf8')
);

const mean=xs=>{
  const a=xs.filter(Number.isFinite);
  return a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
};
const round1=x=>Number.isFinite(x)?Math.round(x*10)/10:null;
const ape=(pred,actual)=>actual?Math.abs(pred-actual)/Math.abs(actual)*100:null;

function actualFor(actual,year){
  return actual.rows.find(r=>+r.year===+year);
}

function metrics(rows){
  return {
    observations:rows.length,
    populationMAE:round1(mean(rows.map(r=>Math.abs(r.populationError)))),
    populationMAPE:round1(mean(rows.map(r=>ape(r.predictedPopulation,r.actualPopulation)))),
    populationMeanError:round1(mean(rows.map(r=>r.populationError))),
    netMigrationMAE:round1(mean(rows.map(r=>Math.abs(r.netMigrationError)))),
    netMigrationMeanError:round1(mean(rows.map(r=>r.netMigrationError))),
    grossInMigrationMAE:round1(mean(rows.map(r=>Math.abs(r.grossInMigrationError)))),
    grossInMigrationMeanError:round1(mean(rows.map(r=>r.grossInMigrationError))),
    grossOutMigrationMAE:round1(mean(rows.map(r=>Math.abs(r.grossOutMigrationError)))),
    grossOutMigrationMeanError:round1(mean(rows.map(r=>r.grossOutMigrationError)))
  };
}

function baselineMetrics(rows){
  return {
    observations:rows.length,
    populationMAE:round1(mean(rows.map(r=>Math.abs(r.baselinePopulationError)))),
    populationMAPE:round1(mean(rows.map(r=>ape(r.baselinePredictedPopulation,r.actualPopulation)))),
    populationMeanError:round1(mean(rows.map(r=>r.baselinePopulationError))),
    netMigrationMAE:round1(mean(rows.map(r=>Math.abs(r.baselineNetMigrationError)))),
    netMigrationMeanError:round1(mean(rows.map(r=>r.baselineNetMigrationError)))
  };
}

const report={
  schemaVersion:'0.1.0',
  method:manifest.method,
  governance:{
    holdoutConfig:manifest.holdoutConfig,
    componentWindowConfig:manifest.componentWindowConfig,
    candidateLockedBeforeResults:manifest.candidateLockedBeforeResults,
    productionDefaultChanged:false,
    decisionRule:manifest.decisionRule,
    note:'These municipality results are independent holdout evidence only for the already-locked component_flow candidate. If parameters are changed after viewing this report, these municipalities may no longer be reused as independent confirmation.'
  },
  origins:manifest.origins,
  horizonYears:manifest.horizonYears,
  municipalities:manifest.municipalities,
  results:{},
  summary:{},
  pooled:{},
  productionGate:{}
};

const allRows=[];

for(const [geo,spec] of Object.entries(manifest.municipalities)){
  report.results[geo]={};
  const geoRows=[];

  for(const entry of manifest.entries.filter(x=>x.geo===geo)){
    const model=JSON.parse(
      fs.readFileSync(path.join(WORKDIR,entry.modelFile),'utf8')
    );
    const actual=JSON.parse(
      fs.readFileSync(path.join(WORKDIR,entry.actualFile),'utf8')
    );

    const baseline=M.simulate(model,{
      geo,
      endYear:entry.endYear,
      fertMult:1,
      mortMult:1,
      migMult:1,
      window:10,
      migrationWindow:10,
      migrationMode:'net',
      cohortTimingMode:'event_age_aligned',
      scenarios:{housing:[],workplaces:[],overlapPct:0},
      includeDetail:false
    });
    const component=M.simulate(model,{
      geo,
      endYear:entry.endYear,
      fertMult:1,
      mortMult:1,
      migMult:1,
      window:10,
      migrationMode:'component_flow',
      cohortTimingMode:'event_age_aligned',
      scenarios:{housing:[],workplaces:[],overlapPct:0},
      includeDetail:false
    });

    const rows=[];
    for(const p of component){
      if(+p.year<=+entry.origin) continue;
      const a=actualFor(actual,p.year);
      const b=baseline.find(x=>+x.year===+p.year);
      if(!a||!b) continue;

      const row={
        origin:+entry.origin,
        year:+p.year,
        horizon:+p.year-+entry.origin,
        actualPopulation:a.population,
        predictedPopulation:p.population,
        populationError:p.population-a.population,
        baselinePredictedPopulation:b.population,
        baselinePopulationError:b.population-a.population,
        predictedGrossInMigration:p.grossInMigration,
        actualGrossInMigration:a.grossInMigration,
        grossInMigrationError:p.grossInMigration-a.grossInMigration,
        predictedGrossOutMigration:p.grossOutMigration,
        actualGrossOutMigration:a.grossOutMigration,
        grossOutMigrationError:p.grossOutMigration-a.grossOutMigration,
        predictedNetMigration:p.netMigration,
        actualNetMigration:a.netMigration,
        netMigrationError:p.netMigration-a.netMigration,
        baselinePredictedNetMigration:b.netMigration,
        baselineNetMigrationError:b.netMigration-a.netMigration
      };
      rows.push(row);
      geoRows.push(row);
      allRows.push({...row,geo});
    }

    report.results[geo][entry.origin]=rows.map(r=>Object.fromEntries(
      Object.entries(r).map(([k,v])=>[k,typeof v==='number'?round1(v):v])
    ));
  }

  const byHorizon={};
  for(let h=1;h<=manifest.horizonYears;h++){
    const rows=geoRows.filter(r=>r.horizon===h);
    byHorizon[h]={
      componentFlow:metrics(rows),
      net10Baseline:baselineMetrics(rows)
    };
  }
  report.summary[geo]={
    name:spec.name,
    rationale:spec.rationale,
    byHorizon,
    oneYear:byHorizon[1],
    twoYear:byHorizon[2],
    threeYear:byHorizon[3]
  };
}

for(let h=1;h<=manifest.horizonYears;h++){
  const rows=allRows.filter(r=>r.horizon===h);
  report.pooled[h]={
    componentFlow:metrics(rows),
    net10Baseline:baselineMetrics(rows)
  };
}

const n1=report.pooled[1];
const n2=report.pooled[2];
const municipalityWorse10=Object.entries(report.summary)
  .filter(([,s])=>{
    const c=s.oneYear.componentFlow.netMigrationMAE;
    const b=s.oneYear.net10Baseline.netMigrationMAE;
    return Number.isFinite(c)&&Number.isFinite(b)&&c>b*1.10;
  })
  .map(([geo,s])=>({geo,name:s.name}));

const gates={
  pooledN1NetMigrationMAE:
    n1.componentFlow.netMigrationMAE<=n1.net10Baseline.netMigrationMAE,
  pooledN1PopulationMAE:
    n1.componentFlow.populationMAE<=n1.net10Baseline.populationMAE*1.05,
  pooledN2NetMigrationMAE:
    n2.componentFlow.netMigrationMAE<=n2.net10Baseline.netMigrationMAE*1.05,
  pooledN2PopulationMAE:
    n2.componentFlow.populationMAE<=n2.net10Baseline.populationMAE*1.05,
  municipalityRobustness:
    municipalityWorse10.length<=1
};
report.productionGate={
  gates,
  municipalitiesMoreThan10PctWorseAtN1NetMigration:municipalityWorse10,
  passedAllGates:Object.values(gates).every(Boolean),
  productionDefaultChanged:false,
  interpretation:'Passing all pre-declared gates is necessary but not sufficient for promotion. Failing any gate keeps the current net-migration baseline as production default.'
};

const outJson=path.join(ROOT,'data','backtests','component_flow_holdout.json');
fs.writeFileSync(outJson,JSON.stringify(report,null,2)+'\n','utf8');

console.log('Wrote data/backtests/component_flow_holdout.json');
console.log(
  `Holdout pooled n+1: component migration MAE=${n1.componentFlow.netMigrationMAE} vs net10=${n1.net10Baseline.netMigrationMAE}; `+
  `population MAE=${n1.componentFlow.populationMAE} vs net10=${n1.net10Baseline.populationMAE}`
);
console.log(
  `Holdout pooled n+2: component migration MAE=${n2.componentFlow.netMigrationMAE} vs net10=${n2.net10Baseline.netMigrationMAE}; `+
  `population MAE=${n2.componentFlow.populationMAE} vs net10=${n2.net10Baseline.populationMAE}`
);
console.log(
  `Pre-declared production gate passed: ${report.productionGate.passedAllGates}`
);
