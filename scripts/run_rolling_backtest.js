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

console.log('Wrote data/backtests/rolling_2018_2024.json/js');
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
