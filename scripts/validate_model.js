const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'model_data.json'), 'utf8'));

global.window = {};
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'model.js'), 'utf8'));
const M = window.RAPSModel;

const WINDOWS = [6, 10, 19];
const TARGET_GEOS = ['2580', '2582', '2581', '2560', '2514', 'FA_LULEA'];
const END_YEAR = 2050;

function sum(arr, fn) {
  return arr.reduce((s, x) => s + Number(fn ? fn(x) : x || 0), 0);
}
function round1(x) { return Math.round(Number(x) * 10) / 10; }
function pctDiff(x, base) {
  return base ? round1((x - base) / base * 100) : null;
}

const basePopulation = {};
for (const geo of data.geographies.map(g => g.code)) {
  basePopulation[geo] = round1(sum(
    data.populationBase.filter(r => r.geo === geo && +r.year === +data.meta.baseYear),
    r => r.value
  ));
}

const fa = data.geographies.find(g => g.code === 'FA_LULEA');
const municipalSum = round1(sum((fa && fa.members || []).map(code => basePopulation[code] || 0)));
const faDifference = round1((basePopulation.FA_LULEA || 0) - municipalSum);

const forecasts = {};
for (const geo of TARGET_GEOS) {
  forecasts[geo] = {};
  for (const window of WINDOWS) {
    const rows = M.simulate(data, {
      geo,
      endYear: END_YEAR,
      fertMult: 1,
      mortMult: 1,
      migMult: 1,
      window,
      scenarios: {housing: [], workplaces: [], overlapPct: 0}
    });
    const first = rows[0];
    const last = rows.at(-1);
    forecasts[geo][window] = {
      startPopulation: round1(first.population),
      endPopulation: round1(last.population),
      change: round1(last.population - first.population),
      changePct: pctDiff(last.population, first.population),
      cumulativeBirths: round1(sum(rows.slice(1), r => r.births)),
      cumulativeDeaths: round1(sum(rows.slice(1), r => r.deaths)),
      cumulativeNetMigration: round1(sum(rows.slice(1), r => r.netMigration)),
      cumulativeScenarioEffect: round1(sum(rows.slice(1), r => r.scenarioEffect || 0))
    };
  }
  const base10 = forecasts[geo][10].endPopulation;
  for (const window of WINDOWS) {
    forecasts[geo][window].differenceVs10YearEnd = round1(
      forecasts[geo][window].endPopulation - base10
    );
    forecasts[geo][window].differenceVs10YearEndPct = pctDiff(
      forecasts[geo][window].endPopulation,
      base10
    );
  }
}

const relativeFactors = data.diagnostics?.relativeFactors || {};

const parameterSummary = {};
for (const geo of TARGET_GEOS) {
  parameterSummary[geo] = {};
  for (const window of WINDOWS) {
    const fert = data.fertilityRates.filter(r => r.geo === geo && +r.window === window);
    const mort = data.mortalityRisks.filter(r => r.geo === geo && +r.window === window);
    const mig = data.netMigration.filter(r => r.geo === geo && +r.window === window);
    parameterSummary[geo][window] = {
      fertilityProfileRows: fert.length,
      fertilityRateSum: round1(sum(fert, r => r.value)),
      mortalityProfileRows: mort.length,
      migrationProfileRows: mig.length,
      annualNetMigrationProfileSum: round1(sum(mig, r => r.value))
    };
  }
}

const warnings = [];
if (Math.abs(faDifference) > 0.5) {
  warnings.push(`FA base population differs from municipal sum by ${faDifference} persons.`);
}
if (data.parameters && data.parameters.sexRatioMaleAtBirthSource) {
  warnings.push(
    'Birth sex ratio source: ' +
    data.parameters.sexRatioMaleAtBirthSource +
    '. Observed FA share is retained only as a diagnostic.'
  );
}
warnings.push('V1.3 keeps 6/10/19-year local fertility, mortality and net-migration profiles constant through the projection horizon; national future SCB assumptions are not yet integrated.');

const report = {
  generatedBy: 'scripts/validate_model.js',
  modelSchemaVersion: data.meta.schemaVersion,
  baseYear: data.meta.baseYear,
  endYear: END_YEAR,
  basePopulation,
  faConsistency: {
    faPopulation: basePopulation.FA_LULEA,
    municipalSum,
    difference: faDifference,
    ok: Math.abs(faDifference) <= 0.5
  },
  parameterSummary,
  relativeFactors,
  forecasts,
  warnings
};

const out = path.join(ROOT, 'data', 'model_validation.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8');

console.log(`Wrote data/model_validation.json`);
console.log(`FA consistency difference: ${faDifference}`);
for (const geo of TARGET_GEOS) {
  for (const window of WINDOWS) {
    const r = forecasts[geo][window];
    console.log(`${geo} window=${window}: ${r.startPopulation} -> ${r.endPopulation} (change ${r.change})`);
  }
}
if (warnings.length) {
  for (const w of warnings) console.log('WARNING:', w);
}
