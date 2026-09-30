const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'model_data.json'), 'utf8'));
const scb = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'benchmarks', 'scb_regional_projection_normalized.json'), 'utf8'));

global.window = {};
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'model.js'), 'utf8'));
const M = window.RAPSModel;

const WINDOWS = [6, 10, 19];
const GEOS = ['2580','2582','2581','2560','2514','FA_LULEA'];
const CHECK_YEARS = [2030, 2040, 2050];

function getScb(geo, year) {
  return scb.rows.find(r => r.geo === geo && +r.year === +year)?.population ?? null;
}
function getActualBase(geo) {
  return data.populationBase
    .filter(r => r.geo === geo && +r.year === +data.meta.baseYear)
    .reduce((s,r)=>s+Number(r.value||0),0);
}
function round1(x) { return Math.round(Number(x)*10)/10; }
function pct(x, base) { return base ? round1((x-base)/base*100) : null; }

const out = {
  schemaVersion: '0.1.0',
  sourceTable: scb.sourceTable,
  modelBaseYear: data.meta.baseYear,
  note: 'SCB is an alternative benchmark, not a target the Raps-like model is forced to match.',
  results: {}
};

for (const geo of GEOS) {
  out.results[geo] = {};
  const actualBase = getActualBase(geo);
  const scbBase = getScb(geo, data.meta.baseYear);
  for (const window of WINDOWS) {
    const forecast = M.simulate(data,{
      geo,
      endYear: 2050,
      fertMult: 1,
      mortMult: 1,
      migMult: 1,
      window,
      scenarios:{housing:[],workplaces:[],overlapPct:0}
    });
    const rows = [];
    for (const year of CHECK_YEARS) {
      const modelPop = forecast.find(r=>+r.year===year)?.population ?? null;
      const rawScb = getScb(geo, year);
      const rebasedScb = (rawScb!=null && scbBase) ? actualBase*(rawScb/scbBase) : null;
      rows.push({
        year,
        modelPopulation: modelPop==null?null:round1(modelPop),
        scbPopulation: rawScb==null?null:round1(rawScb),
        scbRebasedToActual2025: rebasedScb==null?null:round1(rebasedScb),
        differenceVsScb: (modelPop==null||rawScb==null)?null:round1(modelPop-rawScb),
        differenceVsScbPct: (modelPop==null||rawScb==null)?null:pct(modelPop,rawScb),
        differenceVsRebasedScb: (modelPop==null||rebasedScb==null)?null:round1(modelPop-rebasedScb),
        differenceVsRebasedScbPct: (modelPop==null||rebasedScb==null)?null:pct(modelPop,rebasedScb)
      });
    }
    out.results[geo][window] = rows;
  }
}

const target = path.join(ROOT,'data','benchmarks','scb_model_comparison.json');
fs.writeFileSync(target, JSON.stringify(out,null,2)+'\n','utf8');
console.log('Wrote data/benchmarks/scb_model_comparison.json');
for (const geo of GEOS) {
  const r = out.results[geo][10].find(x=>x.year===2050);
  console.log(`${geo} 10-year 2050: model=${r.modelPopulation}, SCB=${r.scbPopulation}, rebased SCB=${r.scbRebasedToActual2025}`);
}
