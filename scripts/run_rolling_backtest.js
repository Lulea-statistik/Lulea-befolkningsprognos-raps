const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKDIR = path.join(ROOT, 'data', 'backtests', 'rolling_work');
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
function round3(x) {
  if (x == null || !Number.isFinite(Number(x))) return null;
  return Math.round(Number(x) * 1000) / 1000;
}
function mean(values) {
  const x = values.filter(Number.isFinite);
  return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null;
}
function ape(pred, obs) {
  return obs ? Math.abs(pred - obs) / Math.abs(obs) * 100 : null;
}
function byActual(actual, geo, year) {
  return actual.rows.find(
    r => r.geo === geo && +r.year === +year
  );
}

function localRatioBounds(model) {
  const bounds = model.diagnostics?.relativeFactors?.bounds || {};
  return {
    min: Number.isFinite(+bounds.min) ? +bounds.min : 0.5,
    max: Number.isFinite(+bounds.max) ? +bounds.max : 1.5
  };
}
function clampRatio(value, bounds) {
  const x = Number(value);
  if (!Number.isFinite(x)) return 1;
  return Math.max(bounds.min, Math.min(bounds.max, x));
}
function fertilityWeightVariant(model, weight) {
  const bounds = localRatioBounds(model);
  const base = new Map(
    (model.fertilityRates || [])
      .filter(r => r.year == null && r.geo !== 'SE')
      .map(r => [`${r.geo}|${+r.window}|${+r.age}`, r])
  );
  return (model.fertilityRates || []).map(r => {
    if (r.geo === 'SE') return r;
    const ref = r.year == null
      ? r
      : base.get(`${r.geo}|${+r.window}|${+r.age}`);
    if (!ref) return r;
    const nationalRate = Number(r.nationalRate);
    if (!Number.isFinite(nationalRate)) return r;
    const generalFactor = Number.isFinite(+ref.municipalityFactor)
      ? +ref.municipalityFactor : 1;
    const rawCellFactor = Number.isFinite(+ref.rawCellFactor)
      ? +ref.rawCellFactor : generalFactor;
    const ratio = weight === 0
      ? generalFactor
      : clampRatio(rawCellFactor, bounds);
    return {...r, value: Math.max(0, nationalRate * ratio)};
  });
}
function mortalityWeightVariant(model, weight) {
  const bounds = localRatioBounds(model);
  const base = new Map(
    (model.mortalityRisks || [])
      .filter(r => r.year == null && r.geo !== 'SE')
      .map(r => [`${r.geo}|${+r.window}|${r.sex}|${+r.age}`, r])
  );
  return (model.mortalityRisks || []).map(r => {
    if (r.geo === 'SE') return r;
    const ref = r.year == null
      ? r
      : base.get(`${r.geo}|${+r.window}|${r.sex}|${+r.age}`);
    if (!ref) return r;
    const nationalHazard = Number(r.nationalHazard);
    if (!Number.isFinite(nationalHazard)) return r;
    const generalFactor = Number.isFinite(+ref.municipalityFactor)
      ? +ref.municipalityFactor : 1;
    const rawCellFactor = Number.isFinite(+ref.rawCellFactor)
      ? +ref.rawCellFactor : generalFactor;
    const ratio = weight === 0
      ? generalFactor
      : clampRatio(rawCellFactor, bounds);
    const hazard = Math.max(0, nationalHazard * ratio);
    return {...r, value: Math.max(0, Math.min(1, 1 - Math.exp(-hazard)))};
  });
}
function sampleVariance(values) {
  const x=values.map(Number).filter(Number.isFinite);
  if(x.length<2) return 0;
  const m=mean(x);
  return x.reduce((s,v)=>s+(v-m)*(v-m),0)/(x.length-1);
}
function empiricalBayesFactors(rows, groupKeyFn, bounds) {
  const groups=new Map();
  for(const r of rows) {
    const k=groupKeyFn(r);
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(r);
  }
  const factors=new Map();
  for(const group of groups.values()) {
    const stats=group.map(r=>{
      const g=clampRatio(r.municipalityFactor,bounds);
      const l=clampRatio(r.rawCellFactor,bounds);
      const delta=Math.log(Math.max(1e-9,l/g));
      const expected=Math.max(0,Number(r.cellExpectedEvents)||0);
      const raw=Math.max(0,Number(r.rawCellFactor)||0);
      const observedApprox=expected*raw;
      const samplingVar=1/Math.max(0.5,observedApprox+0.5);
      return {r,g,l,delta,samplingVar};
    });
    const observedVar=sampleVariance(stats.map(x=>x.delta));
    const meanSampling=mean(stats.map(x=>x.samplingVar))||0;
    const tau2=Math.max(0,observedVar-meanSampling);
    for(const x of stats) {
      const w=tau2<=0?0:tau2/(tau2+x.samplingVar);
      const factor=clampRatio(x.g*Math.exp(w*x.delta),bounds);
      factors.set(x.r,factor);
    }
  }
  return factors;
}
function solveDense(A,b) {
  const n=A.length;
  const M=A.map((row,i)=>row.slice().concat([b[i]]));
  for(let col=0;col<n;col++){
    let pivot=col;
    for(let r=col+1;r<n;r++) if(Math.abs(M[r][col])>Math.abs(M[pivot][col])) pivot=r;
    if(Math.abs(M[pivot][col])<1e-12) continue;
    [M[col],M[pivot]]=[M[pivot],M[col]];
    const div=M[col][col];
    for(let j=col;j<=n;j++) M[col][j]/=div;
    for(let r=0;r<n;r++){
      if(r===col) continue;
      const mult=M[r][col];
      if(!mult) continue;
      for(let j=col;j<=n;j++) M[r][j]-=mult*M[col][j];
    }
  }
  return M.map((row,i)=>Number.isFinite(row[n])?row[n]:0);
}
function smoothingSplineFactors(rows, groupKeyFn, ageFn, bounds, lambda) {
  const groups=new Map();
  for(const r of rows){
    const k=groupKeyFn(r);
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(r);
  }
  const factors=new Map();

  for(const rawGroup of groups.values()){
    const group=rawGroup.slice().sort((a,b)=>ageFn(a)-ageFn(b));
    const n=group.length;
    if(n<3){
      for(const r of group) factors.set(r,clampRatio(r.rawCellFactor,bounds));
      continue;
    }

    const x=group.map(ageFn);
    const h=[];
    let valid=true;
    for(let i=0;i<n-1;i++){
      const dx=x[i+1]-x[i];
      if(!(dx>0)){valid=false;break;}
      h.push(dx);
    }
    if(!valid){
      for(const r of group) factors.set(r,clampRatio(r.rawCellFactor,bounds));
      continue;
    }

    const y=group.map(r=>{
      const g=clampRatio(r.municipalityFactor,bounds);
      const l=clampRatio(r.rawCellFactor,bounds);
      return Math.log(Math.max(1e-9,l/g));
    });

    // Reliability weights are fixed ex ante from expected event information.
    // They are normalized only for numerical stability; forecast outcomes are
    // never used in the spline fit.
    const eventWeights=group.map(r=>Math.max(0.5,Number(r.cellExpectedEvents)||0.5));
    const sorted=eventWeights.slice().sort((a,b)=>a-b);
    const median=sorted[Math.floor(sorted.length/2)]||1;
    const w=eventWeights.map(v=>Math.max(0.05,v/median));

    // Natural cubic smoothing-spline penalty:
    // minimize sum_i w_i (y_i-f_i)^2 + lambda * integral (f''(x))^2 dx.
    // At the observed knots the roughness penalty is K = Q R^-1 Q'.
    const m=n-2;
    const Q=Array.from({length:n},()=>Array(m).fill(0));
    const R=Array.from({length:m},()=>Array(m).fill(0));
    for(let j=0;j<m;j++){
      const h0=h[j], h1=h[j+1];
      Q[j][j]=1/h0;
      Q[j+1][j]=-(1/h0+1/h1);
      Q[j+2][j]=1/h1;
      R[j][j]=(h0+h1)/3;
      if(j<m-1){
        R[j][j+1]=h1/6;
        R[j+1][j]=h1/6;
      }
    }

    // X = R^-1 Q', solved column by column to avoid an explicit inverse.
    const X=Array.from({length:m},()=>Array(n).fill(0));
    for(let col=0;col<n;col++){
      const rhs=Array.from({length:m},(_,j)=>Q[col][j]);
      const sol=solveDense(R,rhs);
      for(let j=0;j<m;j++) X[j][col]=sol[j];
    }

    const K=Array.from({length:n},()=>Array(n).fill(0));
    for(let i=0;i<n;i++){
      for(let j=0;j<n;j++){
        let s=0;
        for(let k=0;k<m;k++) s+=Q[i][k]*X[k][j];
        K[i][j]=s;
      }
    }

    const A=Array.from({length:n},()=>Array(n).fill(0));
    const rhs=Array(n).fill(0);
    for(let i=0;i<n;i++){
      A[i][i]+=w[i];
      rhs[i]=w[i]*y[i];
      for(let j=0;j<n;j++) A[i][j]+=lambda*K[i][j];
    }
    const z=solveDense(A,rhs);
    for(let i=0;i<n;i++){
      const g=clampRatio(group[i].municipalityFactor,bounds);
      factors.set(group[i],clampRatio(g*Math.exp(z[i]),bounds));
    }
  }
  return factors;
}

function penalizedAgeSmoothFactors(rows, groupKeyFn, ageFn, bounds, lambda) {
  const groups=new Map();
  for(const r of rows) {
    const k=groupKeyFn(r);
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(r);
  }
  const factors=new Map();
  for(const rawGroup of groups.values()) {
    const group=rawGroup.slice().sort((a,b)=>ageFn(a)-ageFn(b));
    const n=group.length;
    if(n<3){ for(const r of group) factors.set(r,clampRatio(r.rawCellFactor,bounds)); continue; }
    const events=group.map(r=>Math.max(0.5,Number(r.cellExpectedEvents)||0.5));
    const sortedEvents=events.slice().sort((a,b)=>a-b);
    const median=sortedEvents[Math.floor(sortedEvents.length/2)]||1;
    const weights=events.map(v=>Math.max(0.05,v/median));
    const y=group.map(r=>{
      const g=clampRatio(r.municipalityFactor,bounds);
      const l=clampRatio(r.rawCellFactor,bounds);
      return Math.log(Math.max(1e-9,l/g));
    });
    const A=Array.from({length:n},()=>Array(n).fill(0));
    const rhs=Array(n).fill(0);
    for(let i=0;i<n;i++){ A[i][i]+=weights[i]; rhs[i]+=weights[i]*y[i]; }
    for(let i=0;i<n-2;i++){
      const d=[1,-2,1];
      for(let a=0;a<3;a++) for(let b=0;b<3;b++) A[i+a][i+b]+=lambda*d[a]*d[b];
    }
    const z=solveDense(A,rhs);
    for(let i=0;i<n;i++){
      const g=clampRatio(group[i].municipalityFactor,bounds);
      factors.set(group[i],clampRatio(g*Math.exp(z[i]),bounds));
    }
  }
  return factors;
}
function fertilityCandidateRates(model, method, lambda=10) {
  const bounds=localRatioBounds(model);
  const baseRows=(model.fertilityRates||[]).filter(r=>r.year==null && r.geo!=='SE');
  const factorByRow=method==='eb'
    ? empiricalBayesFactors(baseRows,r=>`${r.geo}|${+r.window}`,bounds)
    : method==='smoothingSpline'
      ? smoothingSplineFactors(baseRows,r=>`${r.geo}|${+r.window}`,r=>+r.age,bounds,lambda)
      : penalizedAgeSmoothFactors(baseRows,r=>`${r.geo}|${+r.window}`,r=>+r.age,bounds,lambda);
  const factorByKey=new Map(baseRows.map(r=>[
    `${r.geo}|${+r.window}|${+r.age}`,
    factorByRow.get(r)
  ]));
  return (model.fertilityRates||[]).map(r=>{
    if(r.geo==='SE') return r;
    const factor=factorByKey.get(`${r.geo}|${+r.window}|${+r.age}`);
    const nat=Number(r.nationalRate);
    if(!Number.isFinite(factor)||!Number.isFinite(nat)) return r;
    return {...r,value:Math.max(0,nat*factor)};
  });
}
function mortalityEmpiricalBayesRates(model) {
  const bounds=localRatioBounds(model);
  const baseRows=(model.mortalityRisks||[]).filter(r=>r.year==null && r.geo!=='SE');
  const factorByRow=empiricalBayesFactors(
    baseRows,r=>`${r.geo}|${+r.window}|${r.sex}`,bounds
  );
  const factorByKey=new Map(baseRows.map(r=>[
    `${r.geo}|${+r.window}|${r.sex}|${+r.age}`,
    factorByRow.get(r)
  ]));
  return (model.mortalityRisks||[]).map(r=>{
    if(r.geo==='SE') return r;
    const factor=factorByKey.get(`${r.geo}|${+r.window}|${r.sex}|${+r.age}`);
    const nat=Number(r.nationalHazard);
    if(!Number.isFinite(factor)||!Number.isFinite(nat)) return r;
    const hazard=Math.max(0,nat*factor);
    return {...r,value:Math.max(0,Math.min(1,1-Math.exp(-hazard)))};
  });
}
function scoreCandidate(entry, geo, window, component, method, lambda=10) {
  const variant=component==='fertility'
    ? {...entry.model,fertilityRates:fertilityCandidateRates(entry.model,method,lambda)}
    : {...entry.model,mortalityRisks:mortalityEmpiricalBayesRates(entry.model)};
  const pred=M.simulate(variant,{
    geo,endYear:entry.endYear,fertMult:1,mortMult:1,migMult:1,window,
    scenarios:{housing:[],workplaces:[],overlapPct:0},includeDetail:false
  });
  const rows=[];
  for(const p of pred){
    if(+p.year<=+entry.origin) continue;
    const a=byActual(entry.actual,geo,p.year);
    if(!a) continue;
    rows.push({
      year:+p.year,horizon:+p.year-+entry.origin,
      populationError:p.population-a.population,
      populationAbsPctError:ape(p.population,a.population),
      birthsError:p.births-a.births,deathsError:p.deaths-a.deaths
    });
  }
  return rows;
}

function smoothSignedAgeSeries(rows, lambda=10) {
  const sorted=rows.slice().sort((a,b)=>+a.age-+b.age);
  const n=sorted.length;
  if(n<3) return sorted.map(r=>({...r}));
  const x=sorted.map(r=>+r.age);
  const h=x.slice(1).map((v,i)=>v-x[i]);
  if(h.some(v=>!(v>0))) return sorted.map(r=>({...r}));
  const m=n-2;
  const Q=Array.from({length:n},()=>Array(m).fill(0));
  const R=Array.from({length:m},()=>Array(m).fill(0));
  for(let j=0;j<m;j++){
    const h0=h[j], h1=h[j+1];
    Q[j][j]=1/h0;
    Q[j+1][j]=-(1/h0+1/h1);
    Q[j+2][j]=1/h1;
    R[j][j]=(h0+h1)/3;
    if(j<m-1){
      R[j][j+1]=h1/6;
      R[j+1][j]=h1/6;
    }
  }
  const X=Array.from({length:m},()=>Array(n).fill(0));
  for(let col=0;col<n;col++){
    const rhs=Array.from({length:m},(_,j)=>Q[col][j]);
    const sol=solveDense(R,rhs);
    for(let j=0;j<m;j++) X[j][col]=sol[j];
  }
  const K=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<n;i++){
    for(let j=0;j<n;j++){
      let s=0;
      for(let k=0;k<m;k++) s+=Q[i][k]*X[k][j];
      K[i][j]=s;
    }
  }
  const A=Array.from({length:n},()=>Array(n).fill(0));
  const y=sorted.map(r=>Number(r.value)||0);
  for(let i=0;i<n;i++){
    A[i][i]=1;
    for(let j=0;j<n;j++) A[i][j]+=lambda*K[i][j];
  }
  let z=solveDense(A,y);
  const rawTotal=y.reduce((s,v)=>s+v,0);
  const smoothTotal=z.reduce((s,v)=>s+v,0);
  const correction=(rawTotal-smoothTotal)/n;
  z=z.map(v=>v+correction);
  return sorted.map((r,i)=>({...r,value:z[i]}));
}
function migrationSplineRows(model, lambda=10) {
  const source=model.netMigration||[];
  const target=source.filter(r=>+r.window===10 && (r.year==null || r.year==='BASE'));
  const replacement=new Map();
  const groups=new Map();
  for(const r of target){
    const k=`${r.geo}|${r.sex}`;
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(r);
  }
  for(const group of groups.values()){
    for(const r of smoothSignedAgeSeries(group,lambda)){
      replacement.set(`${r.geo}|${r.sex}|${+r.age}`,r);
    }
  }
  return source.map(r=>{
    if(+r.window!==10 || !(r.year==null || r.year==='BASE')) return r;
    return replacement.get(`${r.geo}|${r.sex}|${+r.age}`)||r;
  });
}
function ageProfileErrors(entry, geo, predRows) {
  const actualRows=entry.actual.populationAgeRows||[];
  const out=[];
  for(const p of predRows){
    if(+p.year<=+entry.origin || !Array.isArray(p.populationByAgeSex)) continue;
    const predByAge=new Map();
    for(const r of p.populationByAgeSex){
      predByAge.set(+r.age,(predByAge.get(+r.age)||0)+Number(r.value||0));
    }
    for(let age=0;age<=100;age++){
      const actual=actualRows
        .filter(r=>r.geo===geo && +r.year===+p.year && +r.age===age)
        .reduce((s,r)=>s+Number(r.value||0),0);
      const predicted=Number(predByAge.get(age)||0);
      out.push({
        year:+p.year,
        horizon:+p.year-+entry.origin,
        age,
        error:predicted-actual,
        absError:Math.abs(predicted-actual)
      });
    }
  }
  return out;
}

function scoreMigrationSpline(entry, geo, lambda=10) {
  const variant={...entry.model,netMigration:migrationSplineRows(entry.model,lambda)};
  const pred=M.simulate(variant,{
    geo,endYear:entry.endYear,fertMult:1,mortMult:1,migMult:1,
    window:10,migrationWindow:10,cohortTimingMode:'event_age_aligned',
    scenarios:{housing:[],workplaces:[],overlapPct:0},includeDetail:true
  });
  const ageErrors=ageProfileErrors(entry,geo,pred);
  const rows=[];
  for(const p of pred){
    if(+p.year<=+entry.origin) continue;
    const a=byActual(entry.actual,geo,p.year);
    if(!a) continue;
    rows.push({
      year:+p.year,horizon:+p.year-+entry.origin,
      populationError:p.population-a.population,
      populationAbsPctError:ape(p.population,a.population),
      netMigrationError:p.netMigration-a.netMigration,
      predictedNetMigration:p.netMigration,
      actualNetMigration:a.netMigration
    });
  }
  rows.ageErrors=ageErrors;
  return rows;
}

function scoreWeightVariant(entry, geo, window, component, weight) {
  const variant = component === 'fertility'
    ? {...entry.model, fertilityRates: fertilityWeightVariant(entry.model, weight)}
    : {...entry.model, mortalityRisks: mortalityWeightVariant(entry.model, weight)};
  const pred = M.simulate(variant, {
    geo,
    endYear: entry.endYear,
    fertMult: 1,
    mortMult: 1,
    migMult: 1,
    window,
    scenarios: {housing: [], workplaces: [], overlapPct: 0},
    includeDetail: false
  });
  const rows = [];
  for (const p of pred) {
    if (+p.year <= +entry.origin) continue;
    const a = byActual(entry.actual, geo, p.year);
    if (!a) continue;
    rows.push({
      year: +p.year,
      horizon: +p.year - +entry.origin,
      populationError: p.population - a.population,
      populationAbsPctError: ape(p.population, a.population),
      birthsError: p.births - a.births,
      deathsError: p.deaths - a.deaths
    });
  }
  return rows;
}

const origins = manifest.origins.map(entry => {
  const model = JSON.parse(
    fs.readFileSync(path.join(WORKDIR, entry.modelFile), 'utf8')
  );
  const actual = JSON.parse(
    fs.readFileSync(path.join(WORKDIR, entry.actualFile), 'utf8')
  );
  return {...entry, model, actual};
});

if (!origins.length) {
  throw new Error('Rolling-origin manifest contains no origins.');
}

const geos = origins[0].model.geographies.map(g => g.code);
const windows = manifest.windows.map(Number);
const migrationWindows = (manifest.migrationWindows || [2,3,4,6,10]).map(Number);

const report = {
  schemaVersion: '0.1.0',
  method: manifest.method,
  origins: manifest.origins.map(
    ({origin, endYear, detailKey, birthsKey}) => ({
      origin, endYear, detailKey, birthsKey
    })
  ),
  windows,
  horizonYears: manifest.horizonYears,
  overlapNote: manifest.overlapNote,
  results: {},
  summary: {},
  nationalAssumptionBenchmark: {
    note: 'Compares each SCB national forecast vintage directly with realized Sweden births and deaths before local calibration.',
    rows: [],
    summary: {}
  },
  fertilityLocalizationDiagnostic: {
    note: 'Diagnostic only: compares current localized fertility with the same SCB national age-specific fertility profile applied without any local multiplier. It does not change the production baseline.',
    summary: {}
  },
  mortalityLocalizationDiagnostic: {
    note: 'Diagnostic only: compares current localized mortality with the same SCB national age/sex mortality profile applied without any local multiplier. It does not change the production baseline.',
    summary: {}
  },
  ageCellWeightDiagnostic: {
    note: 'Diagnostic only. Isolates the age-cell weighting choice while retaining the broad municipality factor. Compares 0% local age-cell weight, current information-weighted production values, and 100% local age-cell weight. This is distinct from the harder national-only diagnostic, which also removes the broad municipality factor.',
    definitions: {
      zero: 'National age profile multiplied by the broad municipality factor; no one-year local cell deviation.',
      current: 'Production information-weighted blend between broad municipality factor and local one-year cell factor.',
      full: 'Local one-year cell factor at 100% weight, subject to the same fixed local/national ratio bounds.'
    },
    fertility: {summary: {}},
    mortality: {summary: {}}
  },
  localizationMethodDiagnostic: {
    note: 'Development diagnostic only. Compares the current production information weighting with a method-of-moments empirical-Bayes shrinkage candidate, a discrete second-difference penalized age smoother, and a natural cubic smoothing-spline candidate for fertility. The smoothing-spline candidate minimizes weighted squared deviations plus lambda times integrated squared curvature. It is methodologically aligned with penalized-least-squares smoothing splines but does not claim to reproduce SCB internal smoothing-factor choices. Lambda values are fixed sensitivity settings, not a promotion rule.',
    independentHoldout: false,
    fertility: {summary: {}},
    mortality: {summary: {}}
  },
  eventAgeTimingDiagnostic: {
    note: 'Historical comparison of legacy V1 timing against the production event-age aligned cohort step. Primary evaluation horizon is n+1, secondary is n+2, and n+3 is supplementary robustness only.',
    summary: {}
  },
  migrationWindowDiagnostic: {
    note: 'Migration-only comparison: fertility and mortality are fixed to the 10-year calibration while net migration uses 2, 3, 4, 6 or 10 years. n+1 is primary and n+2 secondary.',
    windows: migrationWindows,
    summary: {}
  },
  migrationAgeSmoothingDiagnostic: {
    note: 'Development diagnostic. Compares raw net10 age profile, existing adaptive local+national smoothing, and the pre-locked local+national+analogue smoothing. Analogue municipalities are re-ranked vintage-correctly at each origin.',
    independentHoldout: false,
    candidate: manifest.migrationAgeSmoothingCandidate || null,
    summary: {},
    results: {},
    existingSmoothingGate: null,
    analogueSmoothingGate: null
  },
  migrationSplineDiagnostic: {
    note: 'New development candidate, separate from the previously rejected adaptive migration_age_smoothing. Smooths only the one-year-age distribution of the 10-year net-migration profile with a natural cubic spline at locked lambda=10, while preserving the annual net-migration total separately for each municipality and sex. Production baseline is unchanged.',
    independentHoldout: false,
    lambda: 10,
    summary: {},
    results: {}
  },
  componentFlowDiagnostic: {
    note: 'Development diagnostic only. Compares the locked three-leg component_flow engine with the existing 10-year exogenous net-migration baseline inside the full cohort model. The component windows were selected using Lulea development data, so this is not independent holdout evidence.',
    independentHoldout: false,
    candidate: manifest.componentFlowCandidate || null,
    summary: {},
    results: {}
  },
  componentRecencyDiagnostic: {
    note: 'Stage-1 development diagnostic. Uses the locked component_flow engine but replaces only rest-of-Sweden out-migration hazards with the pre-declared adaptive recency rule selected after #53. Not independent evidence.',
    independentHoldout: false,
    candidate: manifest.migrationRecencyCandidate || null,
    summary: {},
    results: {}
  },
  scbRiskFlowDiagnostic: {
    note: 'Development diagnostic only. Compares a method locked from SCB regional projection documentation with the existing 10-year exogenous net-migration baseline. Domestic inflow is risk-based on the rest of Sweden, outflows are municipal risks, and immigration follows the municipality share of projected national immigration.',
    independentHoldout: false,
    candidate: manifest.scbRiskFlowCandidate || null,
    summary: {},
    results: {}
  },
  profetBirthStatusDiagnostic: {
    note: 'Development diagnostic only. Adds Swedish-born/foreign-born population state and migration risks to the Profet-like risk engine while keeping fertility and mortality unchanged.',
    independentHoldout: false,
    candidate: manifest.profetBirthStatusCandidate || null,
    summary: {},
    results: {}
  },
  profetConsistencyDiagnostic: {
    note: 'Development diagnostic only. Compares the same Profet birth-status engine with and without the locked Norrbotten municipality-to-county consistency layer. Only origins with same-vintage frozen county targets are scored.',
    independentHoldout: false,
    candidate: manifest.profetConsistencyCandidate || null,
    summary: {},
    results: {},
    promotionGate: null
  }
};

for (const entry of origins) {
  for (const row of entry.actual.nationalAssumptionRows || []) {
    report.nationalAssumptionBenchmark.rows.push({
      origin: entry.origin,
      ...Object.fromEntries(
        Object.entries(row).map(([k,v]) => [
          k,
          typeof v === 'number' ? round1(v) : v
        ])
      )
    });
  }
}

{
  const rows = report.nationalAssumptionBenchmark.rows;
  const byOrigin = {};
  for (const entry of origins) {
    const x = rows.filter(row => +row.origin === +entry.origin);
    byOrigin[entry.origin] = {
      observations: x.length,
      birthsMAPE: round1(mean(x.map(row => ape(row.predictedBirths, row.actualBirths)))),
      birthsMAE: round1(mean(x.map(row => Math.abs(row.birthsError)))),
      birthsMeanError: round1(mean(x.map(row => row.birthsError))),
      deathsMAPE: round1(mean(x.map(row => ape(row.predictedDeaths, row.actualDeaths)))),
      deathsMAE: round1(mean(x.map(row => Math.abs(row.deathsError)))),
      deathsMeanError: round1(mean(x.map(row => row.deathsError)))
    };
  }
  report.nationalAssumptionBenchmark.summary = {
    observations: rows.length,
    birthsMAPE: round1(mean(rows.map(row => ape(row.predictedBirths, row.actualBirths)))),
    birthsMAE: round1(mean(rows.map(row => Math.abs(row.birthsError)))),
    birthsMeanError: round1(mean(rows.map(row => row.birthsError))),
    deathsMAPE: round1(mean(rows.map(row => ape(row.predictedDeaths, row.actualDeaths)))),
    deathsMAE: round1(mean(rows.map(row => Math.abs(row.deathsError)))),
    deathsMeanError: round1(mean(rows.map(row => row.deathsError))),
    byOrigin
  };
}

for (const geo of geos) {
  report.results[geo] = {};
  for (const entry of origins) {
    report.results[geo][entry.origin] = {};
    for (const window of windows) {
      const pred = M.simulate(entry.model, {
        geo,
        endYear: entry.endYear,
        fertMult: 1,
        mortMult: 1,
        migMult: 1,
        window,
        cohortTimingMode: 'event_age_aligned',
        scenarios: {housing: [], workplaces: [], overlapPct: 0},
        includeDetail: false
      });

      const rows = [];
      for (const p of pred) {
        if (+p.year <= +entry.origin) continue;
        const a = byActual(entry.actual, geo, p.year);
        if (!a) continue;
        rows.push({
          year: +p.year,
          horizon: +p.year - +entry.origin,
          predictedPopulation: round1(p.population),
          actualPopulation: round1(a.population),
          populationError: round1(p.population - a.population),
          populationAbsPctError: round1(ape(p.population, a.population)),
          predictedBirths: round1(p.births),
          actualBirths: round1(a.births),
          birthsError: round1(p.births - a.births),
          predictedDeaths: round1(p.deaths),
          actualDeaths: round1(a.deaths),
          deathsError: round1(p.deaths - a.deaths),
          predictedNetMigration: round1(p.netMigration),
          actualNetMigration: round1(a.netMigration),
          netMigrationError: round1(p.netMigration - a.netMigration)
        });
      }
      report.results[geo][entry.origin][window] = rows;
    }
  }

  report.summary[geo] = {};
  for (const window of windows) {
    const rows = [];
    for (const entry of origins) {
      rows.push(...report.results[geo][entry.origin][window]);
    }

    const byHorizon = {};
    for (let horizon = 1; horizon <= manifest.horizonYears; horizon++) {
      const hRows = rows.filter(r => r.horizon === horizon);
      byHorizon[horizon] = {
        observations: hRows.length,
        populationMAPE: round1(
          mean(hRows.map(r => r.populationAbsPctError))
        ),
        populationMAE: round1(
          mean(hRows.map(r => Math.abs(r.populationError)))
        ),
        populationMeanError: round1(
          mean(hRows.map(r => r.populationError))
        )
      };
    }

    const originEndErrors = origins.map(entry => {
      const originRows =
        report.results[geo][entry.origin][window] || [];
      const last = originRows.at(-1);
      return {
        origin: entry.origin,
        endYear: entry.endYear,
        error: last ? last.populationError : null,
        absPctError: last ? last.populationAbsPctError : null
      };
    });

    report.summary[geo][window] = {
      observations: rows.length,
      origins: origins.length,
      populationMAPE: round1(
        mean(rows.map(r => r.populationAbsPctError))
      ),
      populationMAE: round1(
        mean(rows.map(r => Math.abs(r.populationError)))
      ),
      populationMeanError: round1(
        mean(rows.map(r => r.populationError))
      ),
      birthsMAE: round1(
        mean(rows.map(r => Math.abs(r.birthsError)))
      ),
      deathsMAE: round1(
        mean(rows.map(r => Math.abs(r.deathsError)))
      ),
      netMigrationMAE: round1(
        mean(rows.map(r => Math.abs(r.netMigrationError)))
      ),
      threeYearMAPE: round1(
        mean(
          rows
            .filter(r => r.horizon === manifest.horizonYears)
            .map(r => r.populationAbsPctError)
        )
      ),
      byHorizon,
      originEndErrors
    };
  }
}


for (const geo of geos) {
  report.fertilityLocalizationDiagnostic.summary[geo] = {};
  for (const window of windows) {
    const currentRows = [];
    const nationalRows = [];
    const byOrigin = {};

    for (const entry of origins) {
      const localized = report.results[geo][entry.origin][window] || [];
      currentRows.push(...localized);

      const nationalModel = {
        ...entry.model,
        fertilityRates: entry.model.fertilityRatesNationalOnly || []
      };
      const pred = M.simulate(nationalModel, {
        geo,
        endYear: entry.endYear,
        fertMult: 1,
        mortMult: 1,
        migMult: 1,
        window,
        scenarios: {housing: [], workplaces: [], overlapPct: 0},
        includeDetail: false
      });

      const altRows = [];
      for (const p of pred) {
        if (+p.year <= +entry.origin) continue;
        const a = byActual(entry.actual, geo, p.year);
        if (!a) continue;
        altRows.push({
          year: +p.year,
          horizon: +p.year - +entry.origin,
          populationError: p.population - a.population,
          populationAbsPctError: ape(p.population, a.population),
          birthsError: p.births - a.births
        });
      }
      nationalRows.push(...altRows);

      const localFactor = entry.model.diagnostics?.relativeFactors?.fertility?.find(
        x => x.geo === geo && +x.window === +window
      )?.applied ?? null;

      byOrigin[entry.origin] = {
        localGeneralFertilityFactor: round3(localFactor),
        localizedBirthsMeanError: round1(mean(localized.map(x => x.birthsError))),
        nationalOnlyBirthsMeanError: round1(mean(altRows.map(x => x.birthsError))),
        localizedPopulationEndError: localized.at(-1)?.populationError ?? null,
        nationalOnlyPopulationEndError: round1(altRows.at(-1)?.populationError)
      };
    }

    report.fertilityLocalizationDiagnostic.summary[geo][window] = {
      observations: currentRows.length,
      localizedBirthsMAE: round1(mean(currentRows.map(x => Math.abs(x.birthsError)))),
      localizedBirthsMeanError: round1(mean(currentRows.map(x => x.birthsError))),
      nationalOnlyBirthsMAE: round1(mean(nationalRows.map(x => Math.abs(x.birthsError)))),
      nationalOnlyBirthsMeanError: round1(mean(nationalRows.map(x => x.birthsError))),
      localizedPopulationMAPE: round1(mean(currentRows.map(x => x.populationAbsPctError))),
      localizedPopulationMeanError: round1(mean(currentRows.map(x => x.populationError))),
      nationalOnlyPopulationMAPE: round1(mean(nationalRows.map(x => x.populationAbsPctError))),
      nationalOnlyPopulationMeanError: round1(mean(nationalRows.map(x => x.populationError))),
      byOrigin
    };
  }
}


for (const geo of geos) {
  report.mortalityLocalizationDiagnostic.summary[geo] = {};
  for (const window of windows) {
    const currentRows = [];
    const nationalRows = [];
    const byOrigin = {};

    for (const entry of origins) {
      const localized = report.results[geo][entry.origin][window] || [];
      currentRows.push(...localized);

      const nationalModel = {
        ...entry.model,
        mortalityRisks: entry.model.mortalityRisksNationalOnly || []
      };
      const pred = M.simulate(nationalModel, {
        geo,
        endYear: entry.endYear,
        fertMult: 1,
        mortMult: 1,
        migMult: 1,
        window,
        scenarios: {housing: [], workplaces: [], overlapPct: 0},
        includeDetail: false
      });

      const altRows = [];
      for (const p of pred) {
        if (+p.year <= +entry.origin) continue;
        const a = byActual(entry.actual, geo, p.year);
        if (!a) continue;
        altRows.push({
          year: +p.year,
          horizon: +p.year - +entry.origin,
          populationError: p.population - a.population,
          populationAbsPctError: ape(p.population, a.population),
          deathsError: p.deaths - a.deaths
        });
      }
      nationalRows.push(...altRows);

      const localFactor = geo === 'FA_LULEA'
        ? null
        : entry.model.diagnostics?.relativeFactors?.mortality?.find(
            x => x.geo === geo && +x.window === +window
          )?.applied ?? null;

      byOrigin[entry.origin] = {
        localGeneralMortalityFactor: round3(localFactor),
        localizedDeathsMeanError: round1(mean(localized.map(x => x.deathsError))),
        nationalOnlyDeathsMeanError: round1(mean(altRows.map(x => x.deathsError))),
        localizedPopulationEndError: localized.at(-1)?.populationError ?? null,
        nationalOnlyPopulationEndError: round1(altRows.at(-1)?.populationError)
      };
    }

    report.mortalityLocalizationDiagnostic.summary[geo][window] = {
      observations: currentRows.length,
      localizedDeathsMAE: round1(mean(currentRows.map(x => Math.abs(x.deathsError)))),
      localizedDeathsMeanError: round1(mean(currentRows.map(x => x.deathsError))),
      nationalOnlyDeathsMAE: round1(mean(nationalRows.map(x => Math.abs(x.deathsError)))),
      nationalOnlyDeathsMeanError: round1(mean(nationalRows.map(x => x.deathsError))),
      localizedPopulationMAPE: round1(mean(currentRows.map(x => x.populationAbsPctError))),
      localizedPopulationMeanError: round1(mean(currentRows.map(x => x.populationError))),
      nationalOnlyPopulationMAPE: round1(mean(nationalRows.map(x => x.populationAbsPctError))),
      nationalOnlyPopulationMeanError: round1(mean(nationalRows.map(x => x.populationError))),
      byOrigin
    };
  }
}


for (const geo of geos) {
  report.ageCellWeightDiagnostic.fertility.summary[geo] = {};
  report.ageCellWeightDiagnostic.mortality.summary[geo] = {};
  for (const window of windows) {
    const currentRows = [];
    const fertZeroRows = [];
    const fertFullRows = [];
    const mortZeroRows = [];
    const mortFullRows = [];

    const byOriginFertility = {};
    const byOriginMortality = {};

    for (const entry of origins) {
      const current = report.results[geo][entry.origin][window] || [];
      const fertZero = scoreWeightVariant(entry, geo, window, 'fertility', 0);
      const fertFull = scoreWeightVariant(entry, geo, window, 'fertility', 1);
      const mortZero = scoreWeightVariant(entry, geo, window, 'mortality', 0);
      const mortFull = scoreWeightVariant(entry, geo, window, 'mortality', 1);

      currentRows.push(...current);
      fertZeroRows.push(...fertZero);
      fertFullRows.push(...fertFull);
      mortZeroRows.push(...mortZero);
      mortFullRows.push(...mortFull);

      byOriginFertility[entry.origin] = {
        zeroWeightBirthsMAE: round1(mean(fertZero.map(x => Math.abs(x.birthsError)))),
        currentWeightBirthsMAE: round1(mean(current.map(x => Math.abs(x.birthsError)))),
        fullLocalBirthsMAE: round1(mean(fertFull.map(x => Math.abs(x.birthsError)))),
        rows: current.map((r,i)=>({
          year:r.year,
          horizon:r.horizon,
          zeroWeightAbsBirthsError:round1(Math.abs(fertZero[i]?.birthsError)),
          currentWeightAbsBirthsError:round1(Math.abs(r.birthsError)),
          fullLocalAbsBirthsError:round1(Math.abs(fertFull[i]?.birthsError))
        }))
      };
      byOriginMortality[entry.origin] = {
        zeroWeightDeathsMAE: round1(mean(mortZero.map(x => Math.abs(x.deathsError)))),
        currentWeightDeathsMAE: round1(mean(current.map(x => Math.abs(x.deathsError)))),
        fullLocalDeathsMAE: round1(mean(mortFull.map(x => Math.abs(x.deathsError)))),
        rows: current.map((r,i)=>({
          year:r.year,
          horizon:r.horizon,
          zeroWeightAbsDeathsError:round1(Math.abs(mortZero[i]?.deathsError)),
          currentWeightAbsDeathsError:round1(Math.abs(r.deathsError)),
          fullLocalAbsDeathsError:round1(Math.abs(mortFull[i]?.deathsError))
        }))
      };
    }

    const fertilityByHorizon = {};
    const mortalityByHorizon = {};
    for (let horizon=1; horizon<=manifest.horizonYears; horizon++) {
      const currentH=currentRows.filter(r=>r.horizon===horizon);
      const f0=fertZeroRows.filter(r=>r.horizon===horizon);
      const f1=fertFullRows.filter(r=>r.horizon===horizon);
      const m0=mortZeroRows.filter(r=>r.horizon===horizon);
      const m1=mortFullRows.filter(r=>r.horizon===horizon);
      fertilityByHorizon[horizon]={
        observations:currentH.length,
        zeroWeightBirthsMAE:round1(mean(f0.map(x=>Math.abs(x.birthsError)))),
        currentWeightBirthsMAE:round1(mean(currentH.map(x=>Math.abs(x.birthsError)))),
        fullLocalBirthsMAE:round1(mean(f1.map(x=>Math.abs(x.birthsError))))
      };
      mortalityByHorizon[horizon]={
        observations:currentH.length,
        zeroWeightDeathsMAE:round1(mean(m0.map(x=>Math.abs(x.deathsError)))),
        currentWeightDeathsMAE:round1(mean(currentH.map(x=>Math.abs(x.deathsError)))),
        fullLocalDeathsMAE:round1(mean(m1.map(x=>Math.abs(x.deathsError))))
      };
    }

    report.ageCellWeightDiagnostic.fertility.summary[geo][window] = {
      observations: currentRows.length,
      zeroWeightBirthsMAE: round1(mean(fertZeroRows.map(x => Math.abs(x.birthsError)))),
      currentWeightBirthsMAE: round1(mean(currentRows.map(x => Math.abs(x.birthsError)))),
      fullLocalBirthsMAE: round1(mean(fertFullRows.map(x => Math.abs(x.birthsError)))),
      zeroWeightPopulationMAPE: round1(mean(fertZeroRows.map(x => x.populationAbsPctError))),
      currentWeightPopulationMAPE: round1(mean(currentRows.map(x => x.populationAbsPctError))),
      fullLocalPopulationMAPE: round1(mean(fertFullRows.map(x => x.populationAbsPctError))),
      byHorizon: fertilityByHorizon,
      byOrigin: byOriginFertility
    };

    report.ageCellWeightDiagnostic.mortality.summary[geo][window] = {
      observations: currentRows.length,
      zeroWeightDeathsMAE: round1(mean(mortZeroRows.map(x => Math.abs(x.deathsError)))),
      currentWeightDeathsMAE: round1(mean(currentRows.map(x => Math.abs(x.deathsError)))),
      fullLocalDeathsMAE: round1(mean(mortFullRows.map(x => Math.abs(x.deathsError)))),
      zeroWeightPopulationMAPE: round1(mean(mortZeroRows.map(x => x.populationAbsPctError))),
      currentWeightPopulationMAPE: round1(mean(currentRows.map(x => x.populationAbsPctError))),
      fullLocalPopulationMAPE: round1(mean(mortFullRows.map(x => x.populationAbsPctError))),
      byHorizon: mortalityByHorizon,
      byOrigin: byOriginMortality
    };
  }
}


for (const geo of geos) {
  report.localizationMethodDiagnostic.fertility.summary[geo]={};
  report.localizationMethodDiagnostic.mortality.summary[geo]={};
  for(const window of windows){
    const currentRows=[];
    const ebFertRows=[];
    const spline1Rows=[];
    const spline10Rows=[];
    const spline100Rows=[];
    const cubicSpline1Rows=[];
    const cubicSpline10Rows=[];
    const cubicSpline100Rows=[];
    const ebMortRows=[];
    for(const entry of origins){
      currentRows.push(...(report.results[geo][entry.origin][window]||[]));
      ebFertRows.push(...scoreCandidate(entry,geo,window,'fertility','eb'));
      spline1Rows.push(...scoreCandidate(entry,geo,window,'fertility','spline',1));
      spline10Rows.push(...scoreCandidate(entry,geo,window,'fertility','spline',10));
      spline100Rows.push(...scoreCandidate(entry,geo,window,'fertility','spline',100));
      cubicSpline1Rows.push(...scoreCandidate(entry,geo,window,'fertility','smoothingSpline',1));
      cubicSpline10Rows.push(...scoreCandidate(entry,geo,window,'fertility','smoothingSpline',10));
      cubicSpline100Rows.push(...scoreCandidate(entry,geo,window,'fertility','smoothingSpline',100));
      ebMortRows.push(...scoreCandidate(entry,geo,window,'mortality','eb'));
    }
    const byHorizonF={};
    const byHorizonM={};
    for(let h=1;h<=manifest.horizonYears;h++){
      const cur=currentRows.filter(r=>r.horizon===h);
      const ebf=ebFertRows.filter(r=>r.horizon===h);
      const s1=spline1Rows.filter(r=>r.horizon===h);
      const s10=spline10Rows.filter(r=>r.horizon===h);
      const s100=spline100Rows.filter(r=>r.horizon===h);
      const cs1=cubicSpline1Rows.filter(r=>r.horizon===h);
      const cs10=cubicSpline10Rows.filter(r=>r.horizon===h);
      const cs100=cubicSpline100Rows.filter(r=>r.horizon===h);
      const ebm=ebMortRows.filter(r=>r.horizon===h);
      byHorizonF[h]={
        currentBirthsMAE:round1(mean(cur.map(x=>Math.abs(x.birthsError)))),
        empiricalBayesBirthsMAE:round1(mean(ebf.map(x=>Math.abs(x.birthsError)))),
        spline1BirthsMAE:round1(mean(s1.map(x=>Math.abs(x.birthsError)))),
        spline10BirthsMAE:round1(mean(s10.map(x=>Math.abs(x.birthsError)))),
        spline100BirthsMAE:round1(mean(s100.map(x=>Math.abs(x.birthsError)))),
        cubicSpline1BirthsMAE:round1(mean(cs1.map(x=>Math.abs(x.birthsError)))),
        cubicSpline10BirthsMAE:round1(mean(cs10.map(x=>Math.abs(x.birthsError)))),
        cubicSpline100BirthsMAE:round1(mean(cs100.map(x=>Math.abs(x.birthsError))))
      };
      byHorizonM[h]={
        currentDeathsMAE:round1(mean(cur.map(x=>Math.abs(x.deathsError)))),
        empiricalBayesDeathsMAE:round1(mean(ebm.map(x=>Math.abs(x.deathsError))))
      };
    }
    report.localizationMethodDiagnostic.fertility.summary[geo][window]={
      observations:currentRows.length,
      currentBirthsMAE:round1(mean(currentRows.map(x=>Math.abs(x.birthsError)))),
      empiricalBayesBirthsMAE:round1(mean(ebFertRows.map(x=>Math.abs(x.birthsError)))),
      spline1BirthsMAE:round1(mean(spline1Rows.map(x=>Math.abs(x.birthsError)))),
      spline10BirthsMAE:round1(mean(spline10Rows.map(x=>Math.abs(x.birthsError)))),
      spline100BirthsMAE:round1(mean(spline100Rows.map(x=>Math.abs(x.birthsError)))),
      cubicSpline1BirthsMAE:round1(mean(cubicSpline1Rows.map(x=>Math.abs(x.birthsError)))),
      cubicSpline10BirthsMAE:round1(mean(cubicSpline10Rows.map(x=>Math.abs(x.birthsError)))),
      cubicSpline100BirthsMAE:round1(mean(cubicSpline100Rows.map(x=>Math.abs(x.birthsError)))),
      byHorizon:byHorizonF
    };
    report.localizationMethodDiagnostic.mortality.summary[geo][window]={
      observations:currentRows.length,
      currentDeathsMAE:round1(mean(currentRows.map(x=>Math.abs(x.deathsError)))),
      empiricalBayesDeathsMAE:round1(mean(ebMortRows.map(x=>Math.abs(x.deathsError)))),
      byHorizon:byHorizonM
    };
  }
}

for (const geo of geos) {
  report.eventAgeTimingDiagnostic.summary[geo] = {};
  for (const window of windows) {
    const legacyRows = [];
    const alignedRows = [];
    const byOrigin = {};

    for (const entry of origins) {
      const aligned = report.results[geo][entry.origin][window] || [];
      alignedRows.push(...aligned);

      const pred = M.simulate(entry.model, {
        geo,
        endYear: entry.endYear,
        fertMult: 1,
        mortMult: 1,
        migMult: 1,
        window,
        cohortTimingMode: 'legacy_start_age',
        scenarios: {housing: [], workplaces: [], overlapPct: 0},
        includeDetail: false
      });

      const legacy = [];
      for (const p of pred) {
        if (+p.year <= +entry.origin) continue;
        const a = byActual(entry.actual, geo, p.year);
        if (!a) continue;
        legacy.push({
          year: +p.year,
          horizon: +p.year - +entry.origin,
          populationError: p.population - a.population,
          populationAbsPctError: ape(p.population, a.population),
          birthsError: p.births - a.births,
          deathsError: p.deaths - a.deaths,
          netMigrationError: p.netMigration - a.netMigration
        });
      }
      legacyRows.push(...legacy);

      byOrigin[entry.origin] = {
        legacyDeathsMeanError: round1(mean(legacy.map(x => x.deathsError))),
        alignedDeathsMeanError: round1(mean(aligned.map(x => x.deathsError))),
        legacyBirthsMeanError: round1(mean(legacy.map(x => x.birthsError))),
        alignedBirthsMeanError: round1(mean(aligned.map(x => x.birthsError))),
        legacyPopulationEndError: round1(legacy.at(-1)?.populationError),
        alignedPopulationEndError: aligned.at(-1)?.populationError ?? null
      };
    }

    const timingByHorizon = {};
    for (let horizon=1; horizon<=manifest.horizonYears; horizon++) {
      const legacyH = legacyRows.filter(r=>r.horizon===horizon);
      const alignedH = alignedRows.filter(r=>r.horizon===horizon);
      timingByHorizon[horizon] = {
        legacy:{
          observations:legacyH.length,
          populationMAPE:round1(mean(legacyH.map(x=>x.populationAbsPctError))),
          populationMAE:round1(mean(legacyH.map(x=>Math.abs(x.populationError)))),
          populationMeanError:round1(mean(legacyH.map(x=>x.populationError))),
          birthsMAE:round1(mean(legacyH.map(x=>Math.abs(x.birthsError)))),
          birthsMeanError:round1(mean(legacyH.map(x=>x.birthsError))),
          deathsMAE:round1(mean(legacyH.map(x=>Math.abs(x.deathsError)))),
          deathsMeanError:round1(mean(legacyH.map(x=>x.deathsError))),
          netMigrationMAE:round1(mean(legacyH.map(x=>Math.abs(x.netMigrationError))))
        },
        aligned:{
          observations:alignedH.length,
          populationMAPE:round1(mean(alignedH.map(x=>x.populationAbsPctError))),
          populationMAE:round1(mean(alignedH.map(x=>Math.abs(x.populationError)))),
          populationMeanError:round1(mean(alignedH.map(x=>x.populationError))),
          birthsMAE:round1(mean(alignedH.map(x=>Math.abs(x.birthsError)))),
          birthsMeanError:round1(mean(alignedH.map(x=>x.birthsError))),
          deathsMAE:round1(mean(alignedH.map(x=>Math.abs(x.deathsError)))),
          deathsMeanError:round1(mean(alignedH.map(x=>x.deathsError))),
          netMigrationMAE:round1(mean(alignedH.map(x=>Math.abs(x.netMigrationError))))
        }
      };
    }

    report.eventAgeTimingDiagnostic.summary[geo][window] = {
      observations: legacyRows.length,
      legacyPopulationMAPE: round1(mean(legacyRows.map(x => x.populationAbsPctError))),
      alignedPopulationMAPE: round1(mean(alignedRows.map(x => x.populationAbsPctError))),
      legacyPopulationMAE: round1(mean(legacyRows.map(x => Math.abs(x.populationError)))),
      alignedPopulationMAE: round1(mean(alignedRows.map(x => Math.abs(x.populationError)))),
      legacyPopulationMeanError: round1(mean(legacyRows.map(x => x.populationError))),
      alignedPopulationMeanError: round1(mean(alignedRows.map(x => x.populationError))),
      legacyBirthsMAE: round1(mean(legacyRows.map(x => Math.abs(x.birthsError)))),
      alignedBirthsMAE: round1(mean(alignedRows.map(x => Math.abs(x.birthsError)))),
      legacyBirthsMeanError: round1(mean(legacyRows.map(x => x.birthsError))),
      alignedBirthsMeanError: round1(mean(alignedRows.map(x => x.birthsError))),
      legacyDeathsMAE: round1(mean(legacyRows.map(x => Math.abs(x.deathsError)))),
      alignedDeathsMAE: round1(mean(alignedRows.map(x => Math.abs(x.deathsError)))),
      legacyDeathsMeanError: round1(mean(legacyRows.map(x => x.deathsError))),
      alignedDeathsMeanError: round1(mean(alignedRows.map(x => x.deathsError))),
      netMigrationMAE: round1(mean(alignedRows.map(x => Math.abs(x.netMigrationError)))),
      oneYear:timingByHorizon[1],
      twoYear:timingByHorizon[2],
      threeYear:timingByHorizon[3],
      byHorizon:timingByHorizon,
      byOrigin
    };
  }
}

for (const geo of geos) {
  report.migrationWindowDiagnostic.summary[geo] = {};
  for (const migrationWindow of migrationWindows) {
    const rows = [];
    const byOrigin = {};

    for (const entry of origins) {
      const pred = M.simulate(entry.model, {
        geo,
        endYear: entry.endYear,
        fertMult: 1,
        mortMult: 1,
        migMult: 1,
        window: 10,
        migrationWindow,
        cohortTimingMode: 'event_age_aligned',
        scenarios: {housing: [], workplaces: [], overlapPct: 0},
        includeDetail: false
      });

      const originRows = [];
      for (const p of pred) {
        if (+p.year <= +entry.origin) continue;
        const a = byActual(entry.actual, geo, p.year);
        if (!a) continue;
        originRows.push({
          year:+p.year,
          horizon:+p.year-+entry.origin,
          populationError:p.population-a.population,
          populationAbsPctError:ape(p.population,a.population),
          netMigrationError:p.netMigration-a.netMigration,
          predictedNetMigration:p.netMigration,
          actualNetMigration:a.netMigration
        });
      }
      rows.push(...originRows);
      byOrigin[entry.origin]=originRows.map(r=>({
        year:r.year,horizon:r.horizon,
        predictedNetMigration:round1(r.predictedNetMigration),
        actualNetMigration:round1(r.actualNetMigration),
        netMigrationError:round1(r.netMigrationError),
        populationError:round1(r.populationError)
      }));
    }

    const byHorizon={};
    for(let horizon=1;horizon<=manifest.horizonYears;horizon++){
      const h=rows.filter(r=>r.horizon===horizon);
      byHorizon[horizon]={
        observations:h.length,
        populationMAPE:round1(mean(h.map(r=>r.populationAbsPctError))),
        populationMAE:round1(mean(h.map(r=>Math.abs(r.populationError)))),
        populationMeanError:round1(mean(h.map(r=>r.populationError))),
        netMigrationMAE:round1(mean(h.map(r=>Math.abs(r.netMigrationError)))),
        netMigrationMeanError:round1(mean(h.map(r=>r.netMigrationError)))
      };
    }

    report.migrationWindowDiagnostic.summary[geo][migrationWindow]={
      observations:rows.length,
      populationMAPE:round1(mean(rows.map(r=>r.populationAbsPctError))),
      populationMAE:round1(mean(rows.map(r=>Math.abs(r.populationError)))),
      netMigrationMAE:round1(mean(rows.map(r=>Math.abs(r.netMigrationError)))),
      netMigrationMeanError:round1(mean(rows.map(r=>r.netMigrationError))),
      oneYear:byHorizon[1],
      twoYear:byHorizon[2],
      threeYear:byHorizon[3],
      byHorizon,
      byOrigin
    };
  }
}

for (const geo of geos) {
  const allRows=[];
  const byOrigin={};
  report.migrationSplineDiagnostic.results[geo]={};
  for(const entry of origins){
    const spline=scoreMigrationSpline(entry,geo,10);
    const raw=report.results[geo][entry.origin][10]||[];
    const rawPred=M.simulate(entry.model,{
      geo,endYear:entry.endYear,fertMult:1,mortMult:1,migMult:1,
      window:10,migrationWindow:10,cohortTimingMode:'event_age_aligned',
      scenarios:{housing:[],workplaces:[],overlapPct:0},includeDetail:true
    });
    const rawAgeErrors=ageProfileErrors(entry,geo,rawPred);
    const splineAgeErrors=spline.ageErrors||[];
    const rows=[];
    for(const s of spline){
      const r=raw.find(x=>+x.year===+s.year);
      if(!r) continue;
      const row={
        year:s.year,horizon:s.horizon,
        splinePopulationError:s.populationError,
        splinePopulationAbsPctError:s.populationAbsPctError,
        rawPopulationError:r.populationError,
        splineNetMigrationError:s.netMigrationError,
        rawNetMigrationError:r.netMigrationError,
        splinePredictedNetMigration:s.predictedNetMigration,
        rawPredictedNetMigration:r.predictedNetMigration,
        actualNetMigration:s.actualNetMigration
      };
      rows.push(row); allRows.push(row);
    }
    byOrigin[entry.origin]=rows.map(r=>({
      year:r.year,horizon:r.horizon,
      splinePopulationError:round1(r.splinePopulationError),
      rawPopulationError:round1(r.rawPopulationError),
      splineNetMigrationError:round1(r.splineNetMigrationError),
      rawNetMigrationError:round1(r.rawNetMigrationError),
      splinePredictedNetMigration:round1(r.splinePredictedNetMigration),
      rawPredictedNetMigration:round1(r.rawPredictedNetMigration),
      actualNetMigration:round1(r.actualNetMigration)
    }));
    report.migrationSplineDiagnostic.results[geo][entry.origin]=byOrigin[entry.origin];
  }
  const byHorizon={};
  for(let h=1;h<=manifest.horizonYears;h++){
    const rows=allRows.filter(r=>r.horizon===h);
    const rawAgeH=rawAgeErrors.filter(r=>r.horizon===h);
    const splineAgeH=splineAgeErrors.filter(r=>r.horizon===h);
    const raw1539=rawAgeH.filter(r=>r.age>=15&&r.age<=39);
    const spline1539=splineAgeH.filter(r=>r.age>=15&&r.age<=39);
    byHorizon[h]={
      observations:rows.length,
      raw:{
        populationMAE:round1(mean(rows.map(r=>Math.abs(r.rawPopulationError)))),
        netMigrationMAE:round1(mean(rows.map(r=>Math.abs(r.rawNetMigrationError)))),
        ageProfileMAE:round1(mean(rawAgeH.map(r=>r.absError))),
        age15to39MAE:round1(mean(raw1539.map(r=>r.absError)))
      },
      spline:{
        populationMAE:round1(mean(rows.map(r=>Math.abs(r.splinePopulationError)))),
        netMigrationMAE:round1(mean(rows.map(r=>Math.abs(r.splineNetMigrationError)))),
        ageProfileMAE:round1(mean(splineAgeH.map(r=>r.absError))),
        age15to39MAE:round1(mean(spline1539.map(r=>r.absError)))
      }
    };
  }
  report.migrationSplineDiagnostic.summary[geo]={
    observations:allRows.length,
    oneYear:byHorizon[1],
    twoYear:byHorizon[2],
    threeYear:byHorizon[3],
    byHorizon,
    byOrigin
  };
}

for (const geo of geos) {
  const allRows=[];
  const byOrigin={};
  report.componentFlowDiagnostic.results[geo]={};

  for (const entry of origins) {
    const pred=M.simulate(entry.model,{
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
    const baselineRows=report.results[geo][entry.origin][10]||[];
    const rows=[];

    for(const p of pred){
      if(+p.year<=+entry.origin) continue;
      const a=byActual(entry.actual,geo,p.year);
      if(!a) continue;
      const base=baselineRows.find(r=>+r.year===+p.year);
      const row={
        year:+p.year,
        horizon:+p.year-+entry.origin,
        componentPopulationError:p.population-a.population,
        componentPopulationAbsPctError:ape(p.population,a.population),
        baselinePopulationError:base?base.populationError:null,
        componentNetMigrationError:p.netMigration-a.netMigration,
        baselineNetMigrationError:base?base.netMigrationError:null,
        predictedGrossInMigration:p.grossInMigration,
        actualGrossInMigration:geo==='FA_LULEA'?null:a.grossInMigration,
        predictedGrossOutMigration:p.grossOutMigration,
        actualGrossOutMigration:geo==='FA_LULEA'?null:a.grossOutMigration,
        predictedNetMigration:p.netMigration,
        actualNetMigration:a.netMigration
      };
      if(geo!=='FA_LULEA'){
        row.grossInMigrationError=p.grossInMigration-a.grossInMigration;
        row.grossOutMigrationError=p.grossOutMigration-a.grossOutMigration;
      }
      rows.push(row);
      allRows.push(row);
    }

    byOrigin[entry.origin]=rows.map(r=>({
      year:r.year,
      horizon:r.horizon,
      componentPopulationError:round1(r.componentPopulationError),
      baselinePopulationError:round1(r.baselinePopulationError),
      predictedGrossInMigration:round1(r.predictedGrossInMigration),
      actualGrossInMigration:round1(r.actualGrossInMigration),
      predictedGrossOutMigration:round1(r.predictedGrossOutMigration),
      actualGrossOutMigration:round1(r.actualGrossOutMigration),
      predictedNetMigration:round1(r.predictedNetMigration),
      actualNetMigration:round1(r.actualNetMigration),
      componentNetMigrationError:round1(r.componentNetMigrationError),
      baselineNetMigrationError:round1(r.baselineNetMigrationError)
    }));
    report.componentFlowDiagnostic.results[geo][entry.origin]=byOrigin[entry.origin];
  }

  const byHorizon={};
  for(let horizon=1;horizon<=manifest.horizonYears;horizon++){
    const h=allRows.filter(r=>r.horizon===horizon);
    byHorizon[horizon]={
      observations:h.length,
      component:{
        populationMAE:round1(mean(h.map(r=>Math.abs(r.componentPopulationError)))),
        populationMAPE:round1(mean(h.map(r=>r.componentPopulationAbsPctError))),
        populationMeanError:round1(mean(h.map(r=>r.componentPopulationError))),
        netMigrationMAE:round1(mean(h.map(r=>Math.abs(r.componentNetMigrationError)))),
        netMigrationMeanError:round1(mean(h.map(r=>r.componentNetMigrationError))),
        grossInMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.grossInMigrationError)))),
        grossOutMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.grossOutMigrationError))))
      },
      net10Baseline:{
        populationMAE:round1(mean(h.map(r=>Math.abs(r.baselinePopulationError)))),
        netMigrationMAE:round1(mean(h.map(r=>Math.abs(r.baselineNetMigrationError))))
      }
    };
  }

  report.componentFlowDiagnostic.summary[geo]={
    observations:allRows.length,
    oneYear:byHorizon[1],
    twoYear:byHorizon[2],
    threeYear:byHorizon[3],
    byHorizon,
    byOrigin
  };
}

for (const geo of geos) {
  const allRows=[];
  const byOrigin={};
  report.componentRecencyDiagnostic.results[geo]={};

  for (const entry of origins) {
    const pred=M.simulate(entry.model,{
      geo,
      endYear:entry.endYear,
      fertMult:1,
      mortMult:1,
      migMult:1,
      window:10,
      migrationMode:'component_recency',
      cohortTimingMode:'event_age_aligned',
      scenarios:{housing:[],workplaces:[],overlapPct:0},
      includeDetail:false
    });
    const baselineRows=report.results[geo][entry.origin][10]||[];
    const rows=[];

    for(const p of pred){
      if(+p.year<=+entry.origin) continue;
      const a=byActual(entry.actual,geo,p.year);
      if(!a) continue;
      const base=baselineRows.find(r=>+r.year===+p.year);
      const row={
        year:+p.year,
        horizon:+p.year-+entry.origin,
        recencyPopulationError:p.population-a.population,
        recencyPopulationAbsPctError:ape(p.population,a.population),
        baselinePopulationError:base?base.populationError:null,
        recencyNetMigrationError:p.netMigration-a.netMigration,
        baselineNetMigrationError:base?base.netMigrationError:null,
        predictedGrossInMigration:p.grossInMigration,
        actualGrossInMigration:geo==='FA_LULEA'?null:a.grossInMigration,
        predictedGrossOutMigration:p.grossOutMigration,
        actualGrossOutMigration:geo==='FA_LULEA'?null:a.grossOutMigration,
        predictedNetMigration:p.netMigration,
        actualNetMigration:a.netMigration
      };
      if(geo!=='FA_LULEA'){
        row.grossInMigrationError=p.grossInMigration-a.grossInMigration;
        row.grossOutMigrationError=p.grossOutMigration-a.grossOutMigration;
      }
      rows.push(row);
      allRows.push(row);
    }

    byOrigin[entry.origin]=rows.map(r=>({
      year:r.year,
      horizon:r.horizon,
      recencyPopulationError:round1(r.recencyPopulationError),
      baselinePopulationError:round1(r.baselinePopulationError),
      predictedGrossInMigration:round1(r.predictedGrossInMigration),
      actualGrossInMigration:round1(r.actualGrossInMigration),
      predictedGrossOutMigration:round1(r.predictedGrossOutMigration),
      actualGrossOutMigration:round1(r.actualGrossOutMigration),
      predictedNetMigration:round1(r.predictedNetMigration),
      actualNetMigration:round1(r.actualNetMigration),
      recencyNetMigrationError:round1(r.recencyNetMigrationError),
      baselineNetMigrationError:round1(r.baselineNetMigrationError)
    }));
    report.componentRecencyDiagnostic.results[geo][entry.origin]=byOrigin[entry.origin];
  }

  const byHorizon={};
  for(let horizon=1;horizon<=manifest.horizonYears;horizon++){
    const h=allRows.filter(r=>r.horizon===horizon);
    const locked=report.componentFlowDiagnostic.summary[geo]?.byHorizon?.[horizon]?.component||null;
    const recency={
      populationMAE:round1(mean(h.map(r=>Math.abs(r.recencyPopulationError)))),
      populationMAPE:round1(mean(h.map(r=>r.recencyPopulationAbsPctError))),
      populationMeanError:round1(mean(h.map(r=>r.recencyPopulationError))),
      netMigrationMAE:round1(mean(h.map(r=>Math.abs(r.recencyNetMigrationError)))),
      netMigrationMeanError:round1(mean(h.map(r=>r.recencyNetMigrationError))),
      grossInMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.grossInMigrationError)))),
      grossOutMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.grossOutMigrationError))))
    };
    byHorizon[horizon]={
      observations:h.length,
      componentRecency:recency,
      lockedComponent:locked,
      net10Baseline:{
        populationMAE:round1(mean(h.map(r=>Math.abs(r.baselinePopulationError)))),
        netMigrationMAE:round1(mean(h.map(r=>Math.abs(r.baselineNetMigrationError))))
      },
      improvementVsLockedComponentPct:locked?{
        populationMAE:locked.populationMAE?round1(100*(locked.populationMAE-recency.populationMAE)/locked.populationMAE):null,
        netMigrationMAE:locked.netMigrationMAE?round1(100*(locked.netMigrationMAE-recency.netMigrationMAE)/locked.netMigrationMAE):null,
        grossOutMigrationMAE:(geo!=='FA_LULEA'&&locked.grossOutMigrationMAE)?round1(100*(locked.grossOutMigrationMAE-recency.grossOutMigrationMAE)/locked.grossOutMigrationMAE):null
      }:null
    };
  }

  report.componentRecencyDiagnostic.summary[geo]={
    observations:allRows.length,
    oneYear:byHorizon[1],
    twoYear:byHorizon[2],
    threeYear:byHorizon[3],
    byHorizon,
    byOrigin
  };
}

for (const geo of geos) {
  const allRows=[];
  const byOrigin={};
  report.scbRiskFlowDiagnostic.results[geo]={};

  for (const entry of origins) {
    const pred=M.simulate(entry.model,{
      geo,
      endYear:entry.endYear,
      fertMult:1,
      mortMult:1,
      migMult:1,
      window:10,
      migrationMode:'scb_risk_flow',
      cohortTimingMode:'event_age_aligned',
      scenarios:{housing:[],workplaces:[],overlapPct:0},
      includeDetail:false
    });
    const baselineRows=report.results[geo][entry.origin][10]||[];
    const rows=[];

    for(const p of pred){
      if(+p.year<=+entry.origin) continue;
      const a=byActual(entry.actual,geo,p.year);
      if(!a) continue;
      const base=baselineRows.find(r=>+r.year===+p.year);
      const row={
        year:+p.year,
        horizon:+p.year-+entry.origin,
        riskPopulationError:p.population-a.population,
        riskPopulationAbsPctError:ape(p.population,a.population),
        baselinePopulationError:base?base.populationError:null,
        riskNetMigrationError:p.netMigration-a.netMigration,
        baselineNetMigrationError:base?base.netMigrationError:null,
        predictedGrossInMigration:p.grossInMigration,
        actualGrossInMigration:geo==='FA_LULEA'?null:a.grossInMigration,
        predictedGrossOutMigration:p.grossOutMigration,
        actualGrossOutMigration:geo==='FA_LULEA'?null:a.grossOutMigration,
        predictedNetMigration:p.netMigration,
        actualNetMigration:a.netMigration
      };
      if(geo!=='FA_LULEA'){
        row.grossInMigrationError=p.grossInMigration-a.grossInMigration;
        row.grossOutMigrationError=p.grossOutMigration-a.grossOutMigration;
      }
      rows.push(row);
      allRows.push(row);
    }

    byOrigin[entry.origin]=rows.map(r=>({
      year:r.year,
      horizon:r.horizon,
      riskPopulationError:round1(r.riskPopulationError),
      baselinePopulationError:round1(r.baselinePopulationError),
      predictedGrossInMigration:round1(r.predictedGrossInMigration),
      actualGrossInMigration:round1(r.actualGrossInMigration),
      predictedGrossOutMigration:round1(r.predictedGrossOutMigration),
      actualGrossOutMigration:round1(r.actualGrossOutMigration),
      predictedNetMigration:round1(r.predictedNetMigration),
      actualNetMigration:round1(r.actualNetMigration),
      riskNetMigrationError:round1(r.riskNetMigrationError),
      baselineNetMigrationError:round1(r.baselineNetMigrationError)
    }));
    report.scbRiskFlowDiagnostic.results[geo][entry.origin]=byOrigin[entry.origin];
  }

  const byHorizon={};
  for(let horizon=1;horizon<=manifest.horizonYears;horizon++){
    const h=allRows.filter(r=>r.horizon===horizon);
    byHorizon[horizon]={
      observations:h.length,
      scbRiskFlow:{
        populationMAE:round1(mean(h.map(r=>Math.abs(r.riskPopulationError)))),
        populationMAPE:round1(mean(h.map(r=>r.riskPopulationAbsPctError))),
        populationMeanError:round1(mean(h.map(r=>r.riskPopulationError))),
        netMigrationMAE:round1(mean(h.map(r=>Math.abs(r.riskNetMigrationError)))),
        netMigrationMeanError:round1(mean(h.map(r=>r.riskNetMigrationError))),
        grossInMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.grossInMigrationError)))),
        grossInMigrationMeanError:geo==='FA_LULEA'?null:round1(mean(h.map(r=>r.grossInMigrationError))),
        grossOutMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.grossOutMigrationError)))),
        grossOutMigrationMeanError:geo==='FA_LULEA'?null:round1(mean(h.map(r=>r.grossOutMigrationError)))
      },
      net10Baseline:{
        populationMAE:round1(mean(h.map(r=>Math.abs(r.baselinePopulationError)))),
        netMigrationMAE:round1(mean(h.map(r=>Math.abs(r.baselineNetMigrationError))))
      }
    };
  }

  report.scbRiskFlowDiagnostic.summary[geo]={
    observations:allRows.length,
    oneYear:byHorizon[1],
    twoYear:byHorizon[2],
    threeYear:byHorizon[3],
    byHorizon,
    byOrigin
  };
}

for (const geo of geos) {
  const allRows=[];
  const byOrigin={};
  report.profetBirthStatusDiagnostic.results[geo]={};

  for (const entry of origins) {
    const pred=M.simulate(entry.model,{
      geo,
      endYear:entry.endYear,
      fertMult:1,
      mortMult:1,
      migMult:1,
      window:10,
      migrationMode:'profet_birth_status',
      cohortTimingMode:'event_age_aligned',
      scenarios:{housing:[],workplaces:[],overlapPct:0},
      includeDetail:false
    });
    const baselineRows=report.results[geo][entry.origin][10]||[];
    const rows=[];

    for(const p of pred){
      if(+p.year<=+entry.origin) continue;
      const a=byActual(entry.actual,geo,p.year);
      if(!a) continue;
      const base=baselineRows.find(r=>+r.year===+p.year);
      const row={
        year:+p.year,
        horizon:+p.year-+entry.origin,
        profetPopulationError:p.population-a.population,
        profetPopulationAbsPctError:ape(p.population,a.population),
        baselinePopulationError:base?base.populationError:null,
        profetNetMigrationError:p.netMigration-a.netMigration,
        baselineNetMigrationError:base?base.netMigrationError:null,
        predictedGrossInMigration:p.grossInMigration,
        actualGrossInMigration:geo==='FA_LULEA'?null:a.grossInMigration,
        predictedGrossOutMigration:p.grossOutMigration,
        actualGrossOutMigration:geo==='FA_LULEA'?null:a.grossOutMigration,
        predictedNetMigration:p.netMigration,
        actualNetMigration:a.netMigration
      };
      if(geo!=='FA_LULEA'){
        row.grossInMigrationError=p.grossInMigration-a.grossInMigration;
        row.grossOutMigrationError=p.grossOutMigration-a.grossOutMigration;
      }
      rows.push(row);
      allRows.push(row);
    }

    byOrigin[entry.origin]=rows.map(r=>({
      year:r.year,
      horizon:r.horizon,
      profetPopulationError:round1(r.profetPopulationError),
      baselinePopulationError:round1(r.baselinePopulationError),
      predictedGrossInMigration:round1(r.predictedGrossInMigration),
      actualGrossInMigration:round1(r.actualGrossInMigration),
      predictedGrossOutMigration:round1(r.predictedGrossOutMigration),
      actualGrossOutMigration:round1(r.actualGrossOutMigration),
      predictedNetMigration:round1(r.predictedNetMigration),
      actualNetMigration:round1(r.actualNetMigration),
      profetNetMigrationError:round1(r.profetNetMigrationError),
      baselineNetMigrationError:round1(r.baselineNetMigrationError)
    }));
    report.profetBirthStatusDiagnostic.results[geo][entry.origin]=byOrigin[entry.origin];
  }

  const byHorizon={};
  for(let horizon=1;horizon<=manifest.horizonYears;horizon++){
    const h=allRows.filter(r=>r.horizon===horizon);
    const scb=report.scbRiskFlowDiagnostic.summary[geo]?.byHorizon?.[horizon]?.scbRiskFlow||null;
    byHorizon[horizon]={
      observations:h.length,
      profetBirthStatus:{
        populationMAE:round1(mean(h.map(r=>Math.abs(r.profetPopulationError)))),
        populationMAPE:round1(mean(h.map(r=>r.profetPopulationAbsPctError))),
        populationMeanError:round1(mean(h.map(r=>r.profetPopulationError))),
        netMigrationMAE:round1(mean(h.map(r=>Math.abs(r.profetNetMigrationError)))),
        netMigrationMeanError:round1(mean(h.map(r=>r.profetNetMigrationError))),
        grossInMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.grossInMigrationError)))),
        grossOutMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.grossOutMigrationError))))
      },
      scbRiskFlow:scb,
      net10Baseline:{
        populationMAE:round1(mean(h.map(r=>Math.abs(r.baselinePopulationError)))),
        netMigrationMAE:round1(mean(h.map(r=>Math.abs(r.baselineNetMigrationError))))
      }
    };
  }

  report.profetBirthStatusDiagnostic.summary[geo]={
    observations:allRows.length,
    oneYear:byHorizon[1],
    twoYear:byHorizon[2],
    threeYear:byHorizon[3],
    byHorizon,
    byOrigin
  };
}


for (const geo of geos) {
  const allRows=[];
  const byOrigin={};
  report.profetConsistencyDiagnostic.results[geo]={};

  for (const entry of origins) {
    if(!(entry.model.profetConsistencyFactors||[]).length) continue;

    const commonOptions={
      geo,
      endYear:entry.endYear,
      fertMult:1,
      mortMult:1,
      migMult:1,
      window:10,
      migrationMode:'profet_birth_status',
      cohortTimingMode:'event_age_aligned',
      scenarios:{housing:[],workplaces:[],overlapPct:0},
      includeDetail:false
    };
    const unadjusted=M.simulate(entry.model,commonOptions);
    const adjusted=M.simulate(entry.model,{
      ...commonOptions,
      consistencyAdjustment:true
    });
    const rows=[];

    for(const p of adjusted){
      if(+p.year<=+entry.origin) continue;
      const a=byActual(entry.actual,geo,p.year);
      const u=unadjusted.find(x=>+x.year===+p.year);
      if(!a||!u) continue;
      const row={
        year:+p.year,
        horizon:+p.year-+entry.origin,
        adjustedPopulationError:p.population-a.population,
        adjustedPopulationAbsPctError:ape(p.population,a.population),
        unadjustedPopulationError:u.population-a.population,
        unadjustedPopulationAbsPctError:ape(u.population,a.population),
        adjustedNetMigrationError:p.netMigration-a.netMigration,
        unadjustedNetMigrationError:u.netMigration-a.netMigration,
        adjustedGrossInMigrationError:geo==='FA_LULEA'?null:p.grossInMigration-a.grossInMigration,
        unadjustedGrossInMigrationError:geo==='FA_LULEA'?null:u.grossInMigration-a.grossInMigration,
        adjustedGrossOutMigrationError:geo==='FA_LULEA'?null:p.grossOutMigration-a.grossOutMigration,
        unadjustedGrossOutMigrationError:geo==='FA_LULEA'?null:u.grossOutMigration-a.grossOutMigration
      };
      rows.push(row);
      allRows.push(row);
    }

    byOrigin[entry.origin]=rows.map(r=>({
      year:r.year,
      horizon:r.horizon,
      adjustedPopulationError:round1(r.adjustedPopulationError),
      unadjustedPopulationError:round1(r.unadjustedPopulationError),
      adjustedNetMigrationError:round1(r.adjustedNetMigrationError),
      unadjustedNetMigrationError:round1(r.unadjustedNetMigrationError),
      adjustedGrossInMigrationError:round1(r.adjustedGrossInMigrationError),
      unadjustedGrossInMigrationError:round1(r.unadjustedGrossInMigrationError),
      adjustedGrossOutMigrationError:round1(r.adjustedGrossOutMigrationError),
      unadjustedGrossOutMigrationError:round1(r.unadjustedGrossOutMigrationError)
    }));
    report.profetConsistencyDiagnostic.results[geo][entry.origin]=byOrigin[entry.origin];
  }

  const byHorizon={};
  for(let horizon=1;horizon<=manifest.horizonYears;horizon++){
    const h=allRows.filter(r=>r.horizon===horizon);
    byHorizon[horizon]={
      observations:h.length,
      adjusted:{
        populationMAE:round1(mean(h.map(r=>Math.abs(r.adjustedPopulationError)))),
        populationMAPE:round1(mean(h.map(r=>r.adjustedPopulationAbsPctError))),
        populationMeanError:round1(mean(h.map(r=>r.adjustedPopulationError))),
        netMigrationMAE:round1(mean(h.map(r=>Math.abs(r.adjustedNetMigrationError)))),
        netMigrationMeanError:round1(mean(h.map(r=>r.adjustedNetMigrationError))),
        grossInMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.adjustedGrossInMigrationError)))),
        grossOutMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.adjustedGrossOutMigrationError))))
      },
      unadjusted:{
        populationMAE:round1(mean(h.map(r=>Math.abs(r.unadjustedPopulationError)))),
        populationMAPE:round1(mean(h.map(r=>r.unadjustedPopulationAbsPctError))),
        populationMeanError:round1(mean(h.map(r=>r.unadjustedPopulationError))),
        netMigrationMAE:round1(mean(h.map(r=>Math.abs(r.unadjustedNetMigrationError)))),
        netMigrationMeanError:round1(mean(h.map(r=>r.unadjustedNetMigrationError))),
        grossInMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.unadjustedGrossInMigrationError)))),
        grossOutMigrationMAE:geo==='FA_LULEA'?null:round1(mean(h.map(r=>Math.abs(r.unadjustedGrossOutMigrationError))))
      }
    };
  }

  report.profetConsistencyDiagnostic.summary[geo]={
    observations:allRows.length,
    origins:Object.keys(byOrigin).map(Number),
    oneYear:byHorizon[1],
    twoYear:byHorizon[2],
    threeYear:byHorizon[3],
    byHorizon,
    byOrigin
  };
}

{
  const s=report.profetConsistencyDiagnostic.summary['2580'];
  const n1=s?.oneYear;
  const n2=s?.twoYear;
  const checks={
    n1PopulationNotWorse:!!n1 && n1.adjusted.populationMAE<=n1.unadjusted.populationMAE,
    n1MigrationNotWorse:!!n1 && n1.adjusted.netMigrationMAE<=n1.unadjusted.netMigrationMAE,
    n1AtLeastOneStrictlyBetter:!!n1 && (
      n1.adjusted.populationMAE<n1.unadjusted.populationMAE ||
      n1.adjusted.netMigrationMAE<n1.unadjusted.netMigrationMAE
    ),
    n2PopulationNotWorse:!!n2 && n2.adjusted.populationMAE<=n2.unadjusted.populationMAE,
    n2MigrationNotWorse:!!n2 && n2.adjusted.netMigrationMAE<=n2.unadjusted.netMigrationMAE
  };
  report.profetConsistencyDiagnostic.promotionGate={
    primaryGeo:'2580',
    developmentOrigins:manifest.profetConsistencyCandidate?.developmentOrigins||[],
    checks,
    passed:Object.values(checks).every(Boolean)
  };
}


{
  const geo='2580';
  const allRows=[];
  const byOrigin={};
  report.migrationAgeSmoothingDiagnostic.results[geo]={};

  for(const entry of origins){
    const localRows=entry.model.netMigrationSmoothed||[];
    const analogueRows=entry.model.netMigrationAnalogueSmoothed||[];
    if(!localRows.length||!analogueRows.length) continue;

    const common={
      geo,
      endYear:entry.endYear,
      fertMult:1,
      mortMult:1,
      migMult:1,
      window:10,
      migrationWindow:10,
      cohortTimingMode:'event_age_aligned',
      scenarios:{housing:[],workplaces:[],overlapPct:0},
      includeDetail:false
    };
    const raw=M.simulate(entry.model,common);
    const local=M.simulate({...entry.model,netMigration:localRows},common);
    const analogue=M.simulate({...entry.model,netMigration:analogueRows},common);
    const rows=[];

    for(const p of raw){
      if(+p.year<=+entry.origin) continue;
      const a=byActual(entry.actual,geo,p.year);
      const l=local.find(x=>+x.year===+p.year);
      const g=analogue.find(x=>+x.year===+p.year);
      if(!a||!l||!g) continue;
      const row={
        year:+p.year,
        horizon:+p.year-+entry.origin,
        rawPopulationError:p.population-a.population,
        localPopulationError:l.population-a.population,
        analoguePopulationError:g.population-a.population,
        rawPopulationAbsPctError:ape(p.population,a.population),
        localPopulationAbsPctError:ape(l.population,a.population),
        analoguePopulationAbsPctError:ape(g.population,a.population),
        rawNetMigrationError:p.netMigration-a.netMigration,
        localNetMigrationError:l.netMigration-a.netMigration,
        analogueNetMigrationError:g.netMigration-a.netMigration,
        rawPredictedNetMigration:p.netMigration,
        localPredictedNetMigration:l.netMigration,
        analoguePredictedNetMigration:g.netMigration,
        actualNetMigration:a.netMigration
      };
      rows.push(row);
      allRows.push(row);
    }

    byOrigin[entry.origin]={
      analogueTop5:entry.model.migrationAgeSmoothingAudit?.analogueTop5||[],
      rows:rows.map(r=>({
        year:r.year,
        horizon:r.horizon,
        rawPopulationError:round1(r.rawPopulationError),
        localPopulationError:round1(r.localPopulationError),
        analoguePopulationError:round1(r.analoguePopulationError),
        rawNetMigrationError:round1(r.rawNetMigrationError),
        localNetMigrationError:round1(r.localNetMigrationError),
        analogueNetMigrationError:round1(r.analogueNetMigrationError),
        rawPredictedNetMigration:round1(r.rawPredictedNetMigration),
        localPredictedNetMigration:round1(r.localPredictedNetMigration),
        analoguePredictedNetMigration:round1(r.analoguePredictedNetMigration),
        actualNetMigration:round1(r.actualNetMigration)
      }))
    };
    report.migrationAgeSmoothingDiagnostic.results[geo][entry.origin]=byOrigin[entry.origin];
  }

  const byHorizon={};
  for(let horizon=1;horizon<=manifest.horizonYears;horizon++){
    const h=allRows.filter(r=>r.horizon===horizon);
    const metrics=(prefix)=>({
      populationMAE:round1(mean(h.map(r=>Math.abs(r[prefix+'PopulationError'])))),
      populationMAPE:round1(mean(h.map(r=>r[prefix+'PopulationAbsPctError']))),
      populationMeanError:round1(mean(h.map(r=>r[prefix+'PopulationError']))),
      netMigrationMAE:round1(mean(h.map(r=>Math.abs(r[prefix+'NetMigrationError'])))),
      netMigrationMeanError:round1(mean(h.map(r=>r[prefix+'NetMigrationError'])))
    });
    byHorizon[horizon]={
      observations:h.length,
      raw:metrics('raw'),
      localNational:metrics('local'),
      localNationalAnalogue:metrics('analogue')
    };
  }

  report.migrationAgeSmoothingDiagnostic.summary[geo]={
    observations:allRows.length,
    origins:Object.keys(byOrigin).map(Number),
    oneYear:byHorizon[1],
    twoYear:byHorizon[2],
    threeYear:byHorizon[3],
    byHorizon,
    byOrigin
  };

  const n1=byHorizon[1],n2=byHorizon[2];
  const existingChecks={
    n1PopulationNotWorse:!!n1&&n1.localNational.populationMAE<=n1.raw.populationMAE,
    n1MigrationNotWorse:!!n1&&n1.localNational.netMigrationMAE<=n1.raw.netMigrationMAE,
    n1AtLeastOneStrictlyBetter:!!n1&&(
      n1.localNational.populationMAE<n1.raw.populationMAE||
      n1.localNational.netMigrationMAE<n1.raw.netMigrationMAE
    ),
    n2PopulationNotWorse:!!n2&&n2.localNational.populationMAE<=n2.raw.populationMAE,
    n2MigrationNotWorse:!!n2&&n2.localNational.netMigrationMAE<=n2.raw.netMigrationMAE
  };
  report.migrationAgeSmoothingDiagnostic.existingSmoothingGate={
    primaryGeo:geo,
    checks:existingChecks,
    passed:Object.values(existingChecks).every(Boolean)
  };

  const analogueChecks={
    n1PopulationNotWorse:!!n1&&
      n1.localNationalAnalogue.populationMAE<=n1.localNational.populationMAE&&
      n1.localNationalAnalogue.populationMAE<=n1.raw.populationMAE,
    n1MigrationNotWorse:!!n1&&
      n1.localNationalAnalogue.netMigrationMAE<=n1.localNational.netMigrationMAE&&
      n1.localNationalAnalogue.netMigrationMAE<=n1.raw.netMigrationMAE,
    n1AtLeastOneStrictlyBetter:!!n1&&(
      (
        n1.localNationalAnalogue.populationMAE<n1.localNational.populationMAE&&
        n1.localNationalAnalogue.populationMAE<n1.raw.populationMAE
      )||
      (
        n1.localNationalAnalogue.netMigrationMAE<n1.localNational.netMigrationMAE&&
        n1.localNationalAnalogue.netMigrationMAE<n1.raw.netMigrationMAE
      )
    ),
    n2PopulationNotWorse:!!n2&&
      n2.localNationalAnalogue.populationMAE<=n2.localNational.populationMAE&&
      n2.localNationalAnalogue.populationMAE<=n2.raw.populationMAE,
    n2MigrationNotWorse:!!n2&&
      n2.localNationalAnalogue.netMigrationMAE<=n2.localNational.netMigrationMAE&&
      n2.localNationalAnalogue.netMigrationMAE<=n2.raw.netMigrationMAE
  };
  report.migrationAgeSmoothingDiagnostic.analogueSmoothingGate={
    primaryGeo:geo,
    checks:analogueChecks,
    passed:Object.values(analogueChecks).every(Boolean)
  };
}

const outJson = path.join(
  ROOT, 'data', 'backtests', 'rolling_2018_2024.json'
);
const outJs = path.join(
  ROOT, 'data', 'backtests', 'rolling_2018_2024.js'
);
fs.writeFileSync(
  outJson,
  JSON.stringify(report, null, 2) + '\n',
  'utf8'
);
fs.writeFileSync(
  outJs,
  'window.MODEL_ROLLING_BACKTEST = ' +
    JSON.stringify(report) +
    ';\n',
  'utf8'
);

const weightCompact = {
  schemaVersion: '0.2.0',
  source: 'rolling_2018_2024',
  windows,
  diagnostic: report.ageCellWeightDiagnostic,
  localizationMethodDiagnostic: report.localizationMethodDiagnostic
};
fs.writeFileSync(
  path.join(ROOT, 'data', 'backtests', 'age_cell_weight_diagnostic.json'),
  JSON.stringify(weightCompact, null, 2) + '\n',
  'utf8'
);
fs.writeFileSync(
  path.join(ROOT, 'data', 'backtests', 'age_cell_weight_diagnostic.js'),
  'window.AGE_CELL_WEIGHT_DIAGNOSTIC = ' +
    JSON.stringify(weightCompact) +
    ';\n',
  'utf8'
);

console.log('Wrote data/backtests/rolling_2018_2024.json/js and age_cell_weight_diagnostic.json/js');
const national = report.nationalAssumptionBenchmark.summary;
console.log(
  `National SCB vintage diagnostic: births mean error=${national.birthsMeanError} | ` +
  `deaths mean error=${national.deathsMeanError} | deaths MAPE=${national.deathsMAPE}%`
);
for (const geo of ['2580', 'FA_LULEA']) {
  for (const window of windows) {
    const s = report.summary[geo][window];
    console.log(
      `${geo} window=${window}: rolling MAPE=${s.populationMAPE}% | ` +
      `3-year MAPE=${s.threeYearMAPE}% | ` +
      `net migration MAE=${s.netMigrationMAE} | ` +
      `mean population error=${s.populationMeanError}`
    );
  }
}

for (const geo of ['2580', 'FA_LULEA']) {
  for (const window of windows) {
    const s = report.fertilityLocalizationDiagnostic.summary[geo][window];
    console.log(
      `${geo} window=${window}: births MAE localized=${s.localizedBirthsMAE} | ` +
      `national-only=${s.nationalOnlyBirthsMAE} | population MAPE localized=${s.localizedPopulationMAPE}% | ` +
      `national-only=${s.nationalOnlyPopulationMAPE}%`
    );
  }
}

for (const geo of ['2580', 'FA_LULEA']) {
  for (const window of windows) {
    const s = report.mortalityLocalizationDiagnostic.summary[geo][window];
    console.log(
      `${geo} window=${window}: deaths mean error localized=${s.localizedDeathsMeanError} | ` +
      `national-only=${s.nationalOnlyDeathsMeanError} | ` +
      `population MAPE localized=${s.localizedPopulationMAPE}% | ` +
      `national-only=${s.nationalOnlyPopulationMAPE}%`
    );
  }
}

for (const geo of ['2580', 'FA_LULEA']) {
  for (const window of windows) {
    const f = report.ageCellWeightDiagnostic.fertility.summary[geo][window];
    const m = report.ageCellWeightDiagnostic.mortality.summary[geo][window];
    console.log(
      `${geo} window=${window}: fertility age-cell weight MAE zero=${f.zeroWeightBirthsMAE} | current=${f.currentWeightBirthsMAE} | full=${f.fullLocalBirthsMAE}`
    );
    console.log(
      `${geo} window=${window}: mortality age-cell weight MAE zero=${m.zeroWeightDeathsMAE} | current=${m.currentWeightDeathsMAE} | full=${m.fullLocalDeathsMAE}`
    );
  }
}

for (const geo of ['2580','FA_LULEA']){
  for(const window of windows){
    const f=report.localizationMethodDiagnostic.fertility.summary[geo][window];
    const m=report.localizationMethodDiagnostic.mortality.summary[geo][window];
    console.log(
      `${geo} window=${window}: fertility methods current=${f.currentBirthsMAE} EB=${f.empiricalBayesBirthsMAE} discrete1=${f.spline1BirthsMAE} discrete10=${f.spline10BirthsMAE} discrete100=${f.spline100BirthsMAE} cubicSpline1=${f.cubicSpline1BirthsMAE} cubicSpline10=${f.cubicSpline10BirthsMAE} cubicSpline100=${f.cubicSpline100BirthsMAE}`
    );
    console.log(
      `${geo} window=${window}: mortality methods current=${m.currentDeathsMAE} EB=${m.empiricalBayesDeathsMAE}`
    );
  }
}

for (const geo of ['2580', 'FA_LULEA']) {
  for (const window of windows) {
    const s = report.eventAgeTimingDiagnostic.summary[geo][window];
    console.log(
      `${geo} window=${window}: timing deaths mean error legacy=${s.legacyDeathsMeanError} | ` +
      `aligned=${s.alignedDeathsMeanError} | population MAPE legacy=${s.legacyPopulationMAPE}% | ` +
      `aligned=${s.alignedPopulationMAPE}%`
    );
  }
}

for (const geo of ['2580','FA_LULEA']) {
  for (const migrationWindow of migrationWindows) {
    const s=report.migrationWindowDiagnostic.summary[geo][migrationWindow];
    console.log(
      `${geo} migrationWindow=${migrationWindow}: n+1 migration MAE=${s.oneYear.netMigrationMAE} | `+
      `n+1 population MAPE=${s.oneYear.populationMAPE}% | n+2 migration MAE=${s.twoYear.netMigrationMAE}`
    );
  }
}

for(const geo of ['2580','FA_LULEA']){
  const s=report.migrationSplineDiagnostic.summary[geo];
  if(!s?.oneYear) continue;
  console.log(
    `${geo} migration spline lambda=10: n+1 population MAE spline=${s.oneYear.spline.populationMAE} raw=${s.oneYear.raw.populationMAE} | net migration MAE spline=${s.oneYear.spline.netMigrationMAE} raw=${s.oneYear.raw.netMigrationMAE} | age-profile MAE spline=${s.oneYear.spline.ageProfileMAE} raw=${s.oneYear.raw.ageProfileMAE} | age15-39 MAE spline=${s.oneYear.spline.age15to39MAE} raw=${s.oneYear.raw.age15to39MAE}`
  );
}

for (const geo of ['2580','FA_LULEA']) {
  const s=report.componentFlowDiagnostic.summary[geo];
  console.log(
    `${geo} component_flow: n+1 migration MAE=${s.oneYear.component.netMigrationMAE} vs net10=${s.oneYear.net10Baseline.netMigrationMAE} | `+
    `n+1 population MAE=${s.oneYear.component.populationMAE} vs net10=${s.oneYear.net10Baseline.populationMAE} | `+
    `n+2 migration MAE=${s.twoYear.component.netMigrationMAE} vs net10=${s.twoYear.net10Baseline.netMigrationMAE}`
  );
}

for (const geo of ['2580','FA_LULEA']) {
  const s=report.componentRecencyDiagnostic.summary[geo];
  console.log(
    `${geo} component_recency: n+1 migration MAE=${s.oneYear.componentRecency.netMigrationMAE} vs component=${s.oneYear.lockedComponent.netMigrationMAE} vs net10=${s.oneYear.net10Baseline.netMigrationMAE} | `+
    `n+1 population MAE=${s.oneYear.componentRecency.populationMAE} vs component=${s.oneYear.lockedComponent.populationMAE} | `+
    `n+2 migration MAE=${s.twoYear.componentRecency.netMigrationMAE} vs component=${s.twoYear.lockedComponent.netMigrationMAE}`
  );
}

for (const geo of ['2580','FA_LULEA']) {
  const s=report.profetBirthStatusDiagnostic.summary[geo];
  console.log(
    `${geo} profet_birth_status: n+1 migration MAE=${s.oneYear.profetBirthStatus.netMigrationMAE} vs net10=${s.oneYear.net10Baseline.netMigrationMAE} | `+
    `n+1 population MAE=${s.oneYear.profetBirthStatus.populationMAE} vs net10=${s.oneYear.net10Baseline.populationMAE} | `+
    `n+2 migration MAE=${s.twoYear.profetBirthStatus.netMigrationMAE} vs net10=${s.twoYear.net10Baseline.netMigrationMAE}`
  );
}

{
  const s=report.migrationAgeSmoothingDiagnostic.summary['2580'];
  if(s?.oneYear){
    console.log(
      `2580 migration age smoothing: n+1 population MAE raw=${s.oneYear.raw.populationMAE} local+national=${s.oneYear.localNational.populationMAE} analogue=${s.oneYear.localNationalAnalogue.populationMAE} | `+
      `n+1 migration MAE raw=${s.oneYear.raw.netMigrationMAE} local+national=${s.oneYear.localNational.netMigrationMAE} analogue=${s.oneYear.localNationalAnalogue.netMigrationMAE}`
    );
    console.log(
      `Smoothing gates: existing=${report.migrationAgeSmoothingDiagnostic.existingSmoothingGate?.passed} analogue=${report.migrationAgeSmoothingDiagnostic.analogueSmoothingGate?.passed}`
    );
  }
}

for (const geo of ['2580','FA_LULEA']) {
  const s=report.profetConsistencyDiagnostic.summary[geo];
  if(!s?.oneYear) continue;
  console.log(
    `${geo} profet_consistency: n+1 population MAE=${s.oneYear.adjusted.populationMAE} vs unadjusted=${s.oneYear.unadjusted.populationMAE} | `+
    `n+1 migration MAE=${s.oneYear.adjusted.netMigrationMAE} vs unadjusted=${s.oneYear.unadjusted.netMigrationMAE} | `+
    `n+2 population MAE=${s.twoYear.adjusted.populationMAE} vs unadjusted=${s.twoYear.unadjusted.populationMAE}`
  );
}
console.log(
  `Profet consistency accuracy gate passed=${report.profetConsistencyDiagnostic.promotionGate?.passed}`
);

for (const geo of ['2580','FA_LULEA']) {
  const s=report.scbRiskFlowDiagnostic.summary[geo];
  console.log(
    `${geo} scb_risk_flow: n+1 migration MAE=${s.oneYear.scbRiskFlow.netMigrationMAE} vs net10=${s.oneYear.net10Baseline.netMigrationMAE} | `+
    `n+1 population MAE=${s.oneYear.scbRiskFlow.populationMAE} vs net10=${s.oneYear.net10Baseline.populationMAE} | `+
    `n+2 migration MAE=${s.twoYear.scbRiskFlow.netMigrationMAE} vs net10=${s.twoYear.net10Baseline.netMigrationMAE}`
  );
}
