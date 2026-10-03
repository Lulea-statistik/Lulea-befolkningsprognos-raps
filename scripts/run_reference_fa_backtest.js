const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.join(ROOT, 'data', 'backtests', 'reference_fa_work');
const manifest = JSON.parse(
  fs.readFileSync(path.join(WORKDIR, 'manifest.json'), 'utf8')
);

global.window = {};
vm.runInThisContext(
  fs.readFileSync(path.join(ROOT, 'js', 'model.js'), 'utf8')
);
const M = window.RAPSModel;

function round1(x) {
  return Number.isFinite(Number(x))
    ? Math.round(Number(x) * 10) / 10
    : null;
}
function mean(values) {
  const x = values.filter(Number.isFinite);
  return x.length ? x.reduce((s,v)=>s+v,0)/x.length : null;
}
function ape(pred, obs) {
  return obs ? Math.abs(pred-obs)/Math.abs(obs)*100 : null;
}
function actualRow(actual, geo, year) {
  return actual.rows.find(r => r.geo === geo && +r.year === +year);
}
function scoreRows(rows) {
  const byHorizon = {};
  for (let horizon=1; horizon<=manifest.horizonYears; horizon++) {
    const hRows = rows.filter(r=>r.horizon===horizon);
    byHorizon[horizon] = {
      observations:hRows.length,
      populationMAPE:round1(mean(hRows.map(r=>r.populationAbsPctError))),
      populationMAE:round1(mean(hRows.map(r=>Math.abs(r.populationError)))),
      populationMeanError:round1(mean(hRows.map(r=>r.populationError))),
      birthsMAE:round1(mean(hRows.map(r=>Math.abs(r.birthsError)))),
      birthsMeanError:round1(mean(hRows.map(r=>r.birthsError))),
      deathsMAE:round1(mean(hRows.map(r=>Math.abs(r.deathsError)))),
      deathsMeanError:round1(mean(hRows.map(r=>r.deathsError))),
      netMigrationMAE:round1(mean(hRows.map(r=>Math.abs(r.netMigrationError))))
    };
  }
  return {
    observations: rows.length,
    populationMAPE: round1(mean(rows.map(r=>r.populationAbsPctError))),
    populationMAE: round1(mean(rows.map(r=>Math.abs(r.populationError)))),
    populationMeanError: round1(mean(rows.map(r=>r.populationError))),
    birthsMAE: round1(mean(rows.map(r=>Math.abs(r.birthsError)))),
    birthsMeanError: round1(mean(rows.map(r=>r.birthsError))),
    deathsMAE: round1(mean(rows.map(r=>Math.abs(r.deathsError)))),
    deathsMeanError: round1(mean(rows.map(r=>r.deathsError))),
    netMigrationMAE: round1(mean(rows.map(r=>Math.abs(r.netMigrationError)))),
    oneYear:byHorizon[1],
    twoYear:byHorizon[2],
    threeYear:byHorizon[3],
    byHorizon
  };
}
function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function mortalityWeightedLeastSquaresRates(model) {
  const bounds=model?.meta?.localRatioBounds||{min:0.5,max:1.5};
  const lo=Number(bounds.min??0.5), hi=Number(bounds.max??1.5);
  const baseRows=(model.mortalityRisks||[]).filter(r=>r.year==null && r.geo!=='SE');
  const groups=new Map();
  for(const r of baseRows){
    const k=`${r.geo}|${+r.window}|${r.sex}`;
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(r);
  }
  const factorByKey=new Map();
  for(const group of groups.values()){
    const pts=[];
    for(const r of group){
      const nat=Number(r.nationalHazard);
      const raw=Number(r.rawCellFactor);
      const expected=Math.max(0,Number(r.cellExpectedEvents)||0);
      const deaths=Math.max(0,expected*Math.max(0,raw));
      const localHazard=nat*raw;
      if(!(nat>0) || !(localHazard>0) || !(deaths>0)) continue;
      pts.push({x:Math.log(nat),y:Math.log(localHazard),w:deaths});
    }
    const sw=pts.reduce((s,p)=>s+p.w,0);
    let intercept=0, slope=1;
    if(sw>0 && pts.length>=2){
      const xbar=pts.reduce((s,p)=>s+p.w*p.x,0)/sw;
      const ybar=pts.reduce((s,p)=>s+p.w*p.y,0)/sw;
      const denom=pts.reduce((s,p)=>s+p.w*(p.x-xbar)*(p.x-xbar),0);
      slope=denom>1e-12
        ? pts.reduce((s,p)=>s+p.w*(p.x-xbar)*(p.y-ybar),0)/denom
        : 1;
      intercept=ybar-slope*xbar;
    }
    for(const r of group){
      const nat=Number(r.nationalHazard);
      let factor=clamp(Number(r.municipalityFactor)||1,lo,hi);
      if(sw>0 && pts.length>=2 && nat>0){
        const fitted=Math.exp(intercept+slope*Math.log(nat));
        factor=clamp(fitted/nat,lo,hi);
      }
      factorByKey.set(`${r.geo}|${+r.window}|${r.sex}|${+r.age}`,factor);
    }
  }
  return (model.mortalityRisks||[]).map(r=>{
    if(r.geo==='SE') return r;
    const factor=factorByKey.get(`${r.geo}|${+r.window}|${r.sex}|${+r.age}`);
    const nat=Number(r.nationalHazard);
    if(!Number.isFinite(factor)||!Number.isFinite(nat)) return r;
    const hazard=Math.max(0,nat*factor);
    return {...r,value:Math.max(0,Math.min(1,1-Math.exp(-hazard)))};
  });
}
function wlsModel(model){
  return {...model,mortalityRisks:mortalityWeightedLeastSquaresRates(model)};
}

function runGeo(model, actual, geo, window, timingMode, migrationWindow=null) {
  const pred = M.simulate(model, {
    geo,
    endYear: actual.endYear,
    fertMult: 1,
    mortMult: 1,
    migMult: 1,
    window,
    ...(migrationWindow==null?{}:{migrationWindow}),
    cohortTimingMode: timingMode,
    scenarios: {housing: [], workplaces: [], overlapPct: 0},
    includeDetail: false
  });
  const rows = [];
  for (const p of pred) {
    if (+p.year <= +actual.origin) continue;
    const a = actualRow(actual, geo, p.year);
    if (!a) continue;
    rows.push({
      year:+p.year,
      horizon:+p.year-+actual.origin,
      populationError:round1(p.population-a.population),
      populationAbsPctError:round1(ape(p.population,a.population)),
      birthsError:round1(p.births-a.births),
      deathsError:round1(p.deaths-a.deaths),
      netMigrationError:round1(p.netMigration-a.netMigration)
    });
  }
  return rows;
}

const report = {
  schemaVersion:'0.1.0',
  scheme:manifest.scheme,
  source:manifest.source,
  method:manifest.method,
  governance:manifest.governance,
  windows:manifest.windows,
  migrationWindows:manifest.migrationWindows||[6,10],
  horizonYears:manifest.horizonYears,
  evaluationPriority:{
    primary:"n+1",
    secondary:"n+2",
    robustnessOnly:"n+3",
    note:"Short-horizon accuracy is the main decision basis; pooled 1-3 year metrics are retained only as supplementary robustness diagnostics."
  },
  regions:{}
};

for (const region of manifest.regions) {
  const loaded = region.origins.map(entry => ({
    ...entry,
    model:JSON.parse(
      fs.readFileSync(path.join(WORKDIR,entry.modelFile),'utf8')
    ),
    actual:JSON.parse(
      fs.readFileSync(path.join(WORKDIR,entry.actualFile),'utf8')
    )
  }));

  const regionOut = {
    fa15Number:region.fa15Number,
    name:region.name,
    rationale:region.rationale,
    members:region.members,
    summary:{},
    byOrigin:{},
    memberSummary:{},
    migrationWindowSummary:{},
    mortalityWlsExternal:{}
  };

  for (const window of manifest.windows.map(Number)) {
    const legacyRows = [];
    const alignedRows = [];
    regionOut.byOrigin[window] = {};

    for (const entry of loaded) {
      const legacy = runGeo(
        entry.model, entry.actual, region.code, window, 'legacy_start_age'
      );
      const aligned = runGeo(
        entry.model, entry.actual, region.code, window, 'event_age_aligned'
      );
      legacyRows.push(...legacy);
      alignedRows.push(...aligned);

      regionOut.byOrigin[window][entry.origin] = {
        legacy:scoreRows(legacy),
        aligned:scoreRows(aligned),
        endPopulationErrorLegacy:legacy.at(-1)?.populationError ?? null,
        endPopulationErrorAligned:aligned.at(-1)?.populationError ?? null
      };
    }

    const legacyScore = scoreRows(legacyRows);
    const alignedScore = scoreRows(alignedRows);
    regionOut.summary[window] = {
      legacy:legacyScore,
      aligned:alignedScore,
      deltaAlignedMinusLegacy:{
        oneYear:{
          populationMAPE:round1(
            alignedScore.oneYear.populationMAPE-legacyScore.oneYear.populationMAPE
          ),
          populationMAE:round1(
            alignedScore.oneYear.populationMAE-legacyScore.oneYear.populationMAE
          ),
          deathsMAE:round1(
            alignedScore.oneYear.deathsMAE-legacyScore.oneYear.deathsMAE
          ),
          deathsMeanError:round1(
            alignedScore.oneYear.deathsMeanError-legacyScore.oneYear.deathsMeanError
          ),
          birthsMAE:round1(
            alignedScore.oneYear.birthsMAE-legacyScore.oneYear.birthsMAE
          )
        },
        twoYear:{
          populationMAPE:round1(
            alignedScore.twoYear.populationMAPE-legacyScore.twoYear.populationMAPE
          ),
          populationMAE:round1(
            alignedScore.twoYear.populationMAE-legacyScore.twoYear.populationMAE
          ),
          deathsMAE:round1(
            alignedScore.twoYear.deathsMAE-legacyScore.twoYear.deathsMAE
          ),
          deathsMeanError:round1(
            alignedScore.twoYear.deathsMeanError-legacyScore.twoYear.deathsMeanError
          ),
          birthsMAE:round1(
            alignedScore.twoYear.birthsMAE-legacyScore.twoYear.birthsMAE
          )
        },
        populationMAPE:round1(
          alignedScore.populationMAPE-legacyScore.populationMAPE
        ),
        populationMAE:round1(
          alignedScore.populationMAE-legacyScore.populationMAE
        ),
        deathsMAE:round1(
          alignedScore.deathsMAE-legacyScore.deathsMAE
        ),
        deathsMeanError:round1(
          alignedScore.deathsMeanError-legacyScore.deathsMeanError
        ),
        birthsMAE:round1(
          alignedScore.birthsMAE-legacyScore.birthsMAE
        )
      }
    };
  }

  {
    const window=10;
    const currentRows=[];
    const wlsRows=[];
    const byOrigin={};
    for(const entry of loaded){
      const current=runGeo(
        entry.model,entry.actual,region.code,window,'event_age_aligned'
      );
      const wls=runGeo(
        wlsModel(entry.model),entry.actual,region.code,window,'event_age_aligned'
      );
      currentRows.push(...current);
      wlsRows.push(...wls);
      byOrigin[entry.origin]={
        current:scoreRows(current),
        wls:scoreRows(wls)
      };
    }
    regionOut.mortalityWlsExternal={
      window,
      current:scoreRows(currentRows),
      wls:scoreRows(wlsRows),
      byOrigin
    };
  }

  for (const migrationWindow of (manifest.migrationWindows||[6,10]).map(Number)) {
    const rows=[];
    const byOrigin={};
    for (const entry of loaded) {
      const rr=runGeo(
        entry.model,entry.actual,region.code,10,
        'event_age_aligned',migrationWindow
      );
      rows.push(...rr);
      byOrigin[entry.origin]=scoreRows(rr);
    }
    regionOut.migrationWindowSummary[migrationWindow]={
      ...scoreRows(rows),
      byOrigin
    };
  }

  for (const member of Object.keys(region.members)) {
    regionOut.memberSummary[member] = {};
    for (const window of manifest.windows.map(Number)) {
      const legacyRows = [];
      const alignedRows = [];
      for (const entry of loaded) {
        legacyRows.push(...runGeo(
          entry.model, entry.actual, member, window, 'legacy_start_age'
        ));
        alignedRows.push(...runGeo(
          entry.model, entry.actual, member, window, 'event_age_aligned'
        ));
      }
      regionOut.memberSummary[member][window] = {
        name:region.members[member],
        legacy:scoreRows(legacyRows),
        aligned:scoreRows(alignedRows)
      };
    }
  }

  report.regions[region.code] = regionOut;
}

{
  const regionRows=Object.entries(report.regions).map(([code,r])=>({
    code,
    name:r.name,
    current:r.mortalityWlsExternal.current,
    wls:r.mortalityWlsExternal.wls
  }));
  const checks=[];
  for(const r of regionRows){
    for(const horizon of ['oneYear','twoYear']){
      checks.push({
        region:r.code,
        horizon,
        currentDeathsMAE:r.current[horizon].deathsMAE,
        wlsDeathsMAE:r.wls[horizon].deathsMAE,
        passed:r.wls[horizon].deathsMAE<=r.current[horizon].deathsMAE
      });
    }
  }
  const currentPooled=mean(regionRows.flatMap(r=>[
    r.current.oneYear.deathsMAE,r.current.twoYear.deathsMAE
  ]));
  const wlsPooled=mean(regionRows.flatMap(r=>[
    r.wls.oneYear.deathsMAE,r.wls.twoYear.deathsMAE
  ]));
  report.mortalityWlsExternalGate={
    status:'predeclared_external_gate',
    window:10,
    regions:regionRows.map(r=>r.code),
    primaryHorizons:['n+1','n+2'],
    n3Role:'robustness_only',
    rule:'WLS must be non-worse than current mortality for n+1 and n+2 in every locked FA15 reference region, and pooled n+1/n+2 deaths MAE must be strictly lower.',
    checks,
    currentPooledDeathsMAE:round1(currentPooled),
    wlsPooledDeathsMAE:round1(wlsPooled),
    passed:checks.every(x=>x.passed) && wlsPooled<currentPooled
  };
}

const outJson=path.join(
  ROOT,'data','backtests','reference_fa_rolling.json'
);
const outJs=path.join(
  ROOT,'data','backtests','reference_fa_rolling.js'
);
fs.writeFileSync(outJson,JSON.stringify(report,null,2)+'\n','utf8');
fs.writeFileSync(
  outJs,
  'window.MODEL_REFERENCE_FA_BACKTEST = '+JSON.stringify(report)+';\n',
  'utf8'
);

console.log('Wrote data/backtests/reference_fa_rolling.json/js');
console.log('Mortality WLS external gate:',JSON.stringify(report.mortalityWlsExternalGate));
for (const [code,region] of Object.entries(report.regions)) {
  if(region.mortalityWlsExternal){
    const x=region.mortalityWlsExternal;
    console.log(
      `${code} ${region.name} mortality WLS 10y: n+1 current=${x.current.oneYear.deathsMAE} WLS=${x.wls.oneYear.deathsMAE} | n+2 current=${x.current.twoYear.deathsMAE} WLS=${x.wls.twoYear.deathsMAE} | n+3 current=${x.current.threeYear.deathsMAE} WLS=${x.wls.threeYear.deathsMAE}`
    );
  }
  for (const migrationWindow of report.migrationWindows) {
    const m=region.migrationWindowSummary[migrationWindow];
    console.log(
      `${code} ${region.name} migrationWindow=${migrationWindow}: `+
      `n+1 migration MAE=${m.oneYear.netMigrationMAE} | `+
      `n+1 population MAPE=${m.oneYear.populationMAPE}% | `+
      `n+2 migration MAE=${m.twoYear.netMigrationMAE}`
    );
  }
  for (const window of report.windows) {
    const s=region.summary[window];
    console.log(
      `${code} ${region.name} window=${window}: `+
      `1y MAPE legacy=${s.legacy.oneYear.populationMAPE}% aligned=${s.aligned.oneYear.populationMAPE}% | `+
      `1y deaths MAE legacy=${s.legacy.oneYear.deathsMAE} aligned=${s.aligned.oneYear.deathsMAE} | `+
      `2y MAPE legacy=${s.legacy.twoYear.populationMAPE}% aligned=${s.aligned.twoYear.populationMAPE}%`
    );
  }
}
