const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const input = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'backtests', 'model_2022_input.json'), 'utf8'));
const actual = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'backtests', 'actual_2022_2024.json'), 'utf8'));

global.window = {};
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'model.js'), 'utf8'));
const M = window.RAPSModel;

const WINDOWS = [6, 10];
const geos = input.geographies.map(g => g.code);

function byActual(geo, year) {
  return actual.rows.find(r => r.geo === geo && +r.year === +year);
}
function byActualAge(geo, year, age) {
  return (actual.ageRows||[]).find(r =>
    r.geo === geo && +r.year === +year && +r.age === +age
  );
}
function ape(pred, obs) {
  return obs ? Math.abs(pred - obs) / Math.abs(obs) * 100 : null;
}
function round1(x) {
  return Math.round(Number(x) * 10) / 10;
}
function mean(values) {
  const x = values.filter(v => Number.isFinite(v));
  return x.length ? x.reduce((s,v)=>s+v,0)/x.length : null;
}

const report = {
  schemaVersion: '0.1.0',
  method: 'Out-of-sample forecast from 2021 using only data through 2021; compared with actual 2022-2024.',
  baseYear: 2021,
  endYear: 2024,
  windows: WINDOWS,
  results: {},
  ageErrors: {},
  summary: {}
};

for (const geo of geos) {
  report.results[geo] = {};
  report.ageErrors[geo] = {};
  report.summary[geo] = {};
  for (const window of WINDOWS) {
    const pred = M.simulate(input, {
      geo,
      endYear: 2024,
      fertMult: 1,
      mortMult: 1,
      migMult: 1,
      window,
      scenarios: {housing: [], workplaces: [], overlapPct: 0},
      includeDetail: true
    });

    const rows = [];
    for (const p of pred) {
      if (+p.year <= 2021) continue;
      const a = byActual(geo, p.year);
      if (!a) continue;
      rows.push({
        year: p.year,
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
    report.results[geo][window] = rows;
    const ageRows = [];
    for (const p of pred) {
      if (+p.year <= 2021 || !p.populationByAgeSex) continue;
      for (let age=0; age<=100; age++) {
        const predicted = p.populationByAgeSex
          .filter(r=>+r.age===age)
          .reduce((s,r)=>s+Number(r.value||0),0);
        const a = byActualAge(geo,p.year,age);
        if (!a) continue;
        ageRows.push({
          year:+p.year,
          age,
          predictedPopulation:round1(predicted),
          actualPopulation:round1(a.total),
          error:round1(predicted-a.total),
          absError:round1(Math.abs(predicted-a.total)),
          pctError:a.total?round1((predicted-a.total)/a.total*100):null,
          absPctError:round1(ape(predicted,a.total))
        });
      }
    }
    report.ageErrors[geo][window] = ageRows;

    report.summary[geo][window] = {
      populationMAPE: round1(mean(rows.map(r=>r.populationAbsPctError))),
      populationMAE: round1(mean(rows.map(r=>Math.abs(r.populationError)))),
      birthsMAE: round1(mean(rows.map(r=>Math.abs(r.birthsError)))),
      deathsMAE: round1(mean(rows.map(r=>Math.abs(r.deathsError)))),
      netMigrationMAE: round1(mean(rows.map(r=>Math.abs(r.netMigrationError)))),
      populationError2024: rows.length ? rows.at(-1).populationError : null,
      populationAbsPctError2024: rows.length ? rows.at(-1).populationAbsPctError : null,
      ageMAE2024: round1(mean(ageRows.filter(r=>r.year===2024).map(r=>r.absError))),
      ageMAPE2024: round1(mean(ageRows.filter(r=>r.year===2024).map(r=>r.absPctError)))
    };
  }
}

const out = path.join(ROOT, 'data', 'backtests', 'backtest_2022_2024.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8');
fs.writeFileSync(
  path.join(ROOT, 'data', 'backtests', 'backtest_2022_2024.js'),
  'window.MODEL_BACKTEST = ' + JSON.stringify(report) + ';\n',
  'utf8'
);

console.log('Wrote data/backtests/backtest_2022_2024.json/js');
for (const geo of ['2580','2582','2581','2560','2514','FA_LULEA']) {
  for (const window of WINDOWS) {
    const s = report.summary[geo][window];
    console.log(`${geo} window=${window}: population MAPE=${s.populationMAPE}% | 2024 error=${s.populationError2024}`);
  }
}
