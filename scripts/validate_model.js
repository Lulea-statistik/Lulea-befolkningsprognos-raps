const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'model_data.json'), 'utf8'));

global.window = {};
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'model.js'), 'utf8'));
const M = window.RAPSModel;

const WINDOWS = [6, 10, 19];
const MIGRATION_WINDOWS = (data.diagnostics?.migrationCalibrationWindows || [2,4,6,10]).map(Number);
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
const simulationRows = {};
for (const geo of TARGET_GEOS) {
  forecasts[geo] = {};
  simulationRows[geo] = {};
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
    simulationRows[geo][window] = rows;
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

const fertilitySensitivity = {
  defaultScenario: data.parameters?.defaultFertilityScenario || 'raps2024',
  scenarios: data.fertilityScenarios || [],
  nationalTFR: (data.fertilityScenarioNationalTFR || []).filter(r =>
    [2026,2030,2040,2050].includes(+r.year)
  ),
  geographies: {}
};

for (const geo of ['2580','FA_LULEA']) {
  fertilitySensitivity.geographies[geo] = {};
  const base = forecasts[geo][10];
  for (const s of fertilitySensitivity.scenarios) {
    const rows = M.simulate(data, {
      geo,
      endYear: END_YEAR,
      fertilityScenario: s.id,
      fertMult: 1,
      mortMult: 1,
      migMult: 1,
      window: 10,
      scenarios: {housing: [], workplaces: [], overlapPct: 0}
    });
    const last = rows.at(-1);
    const cumulativeBirths = round1(sum(rows.slice(1), r => r.births));
    fertilitySensitivity.geographies[geo][s.id] = {
      label: s.label || s.id,
      endPopulation: round1(last.population),
      cumulativeBirths,
      deltaPopulationVsBaseline: round1(last.population - base.endPopulation),
      deltaPopulationPctVsBaseline: pctDiff(last.population, base.endPopulation),
      deltaBirthsVsBaseline: round1(cumulativeBirths - base.cumulativeBirths)
    };
  }
}

const migrationSensitivity = {
  baseWindow: 10,
  windows: MIGRATION_WINDOWS,
  geographies: {},
  observed2025: data.diagnostics?.migration2025Validation || []
};

for (const geo of ['2580','FA_LULEA']) {
  migrationSensitivity.geographies[geo] = {};
  const base = forecasts[geo][10];
  for (const migrationWindow of MIGRATION_WINDOWS) {
    const rows = M.simulate(data, {
      geo,
      endYear: END_YEAR,
      fertilityScenario: data.parameters?.defaultFertilityScenario || 'raps2024',
      fertMult: 1,
      mortMult: 1,
      migMult: 1,
      window: 10,
      migrationWindow,
      scenarios: {housing: [], workplaces: [], overlapPct: 0}
    });
    const last = rows.at(-1);
    const cumulativeBirths = round1(sum(rows.slice(1), r => r.births));
    const cumulativeDeaths = round1(sum(rows.slice(1), r => r.deaths));
    const cumulativeNetMigration = round1(sum(rows.slice(1), r => r.netMigration));
    migrationSensitivity.geographies[geo][migrationWindow] = {
      endPopulation: round1(last.population),
      cumulativeBirths,
      cumulativeDeaths,
      cumulativeNetMigration,
      annualMeanNetMigration: round1(cumulativeNetMigration / Math.max(1, END_YEAR - data.meta.baseYear)),
      deltaPopulationVs10Year: round1(last.population - base.endPopulation),
      deltaPopulationPctVs10Year: pctDiff(last.population, base.endPopulation),
      deltaNetMigrationVs10Year: round1(cumulativeNetMigration - base.cumulativeNetMigration)
    };
  }
}

const migrationLegWindowDiagnostic = {
  note: 'Migration-only component validation for Lulea municipality. n+1 is primary and n+2 secondary. Each leg/direction is scored independently from population projection results.',
  labels: data.diagnostics?.migrationLegs?.labels || {},
  windows: MIGRATION_WINDOWS,
  summary: {},
  observed2025: (data.diagnostics?.migrationLegs?.observed2025 || []).filter(r => r.geo === '2580')
};

const migrationLegRows = data.diagnostics?.migrationLegs?.windowBacktestLulea || [];
for (const leg of Object.keys(migrationLegWindowDiagnostic.labels)) {
  migrationLegWindowDiagnostic.summary[leg] = {};
  for (const direction of ['in','out','net']) {
    migrationLegWindowDiagnostic.summary[leg][direction] = {};
    for (const window of MIGRATION_WINDOWS) {
      const rows = migrationLegRows.filter(r =>
        r.leg === leg && r.direction === direction && +r.window === +window
      );
      const byHorizon = {};
      for (const horizon of [1,2]) {
        const h = rows.filter(r => +r.horizon === horizon);
        byHorizon[horizon] = {
          observations: h.length,
          MAE: round1(h.length ? sum(h, r => Math.abs(r.error)) / h.length : 0),
          meanError: round1(h.length ? sum(h, r => r.error) / h.length : 0)
        };
      }
      migrationLegWindowDiagnostic.summary[leg][direction][window] = {
        oneYear: byHorizon[1],
        twoYear: byHorizon[2]
      };
    }
  }
}

const faForecastConsistency = {};
for (const window of WINDOWS) {
  const faRows = simulationRows.FA_LULEA[window];
  let maxAbsDifference = 0;
  let endDifference = 0;
  for (let i = 0; i < faRows.length; i++) {
    const municipalPopulation = sum(
      (fa && fa.members || []).map(code => simulationRows[code][window][i].population)
    );
    const difference = faRows[i].population - municipalPopulation;
    maxAbsDifference = Math.max(maxAbsDifference, Math.abs(difference));
    if (i === faRows.length - 1) endDifference = difference;
  }
  faForecastConsistency[window] = {
    maxAbsDifference: round1(maxAbsDifference),
    endDifference: round1(endDifference),
    ok: maxAbsDifference <= 1e-6
  };
}
const maxForecastDifference = Math.max(
  ...Object.values(faForecastConsistency).map(x => x.maxAbsDifference)
);

const relativeFactors = data.diagnostics?.relativeFactors || {};


function fadingExamplesFor(geo, window) {
  const fertilityAges = [15,20,25,30,35,40,45];
  const mortalityAges = [0,15,25,40,65,80,90];
  const fertility = fertilityAges.map(age => {
    const r = data.fertilityRates.find(x =>
      x.geo === geo && +x.window === +window && x.year == null && +x.age === age
    );
    return r ? {
      age,
      localWeight: round1((r.cellLocalWeight || 0) * 100),
      averageAnnualExposure: r.cellAverageAnnualExposure ?? null,
      expectedEvents: r.cellExpectedEvents ?? null,
      nationalRate: r.nationalRate ?? null,
      modelRate: r.value ?? null,
      rawCellFactor: r.rawCellFactor ?? null
    } : {age, localWeight:null};
  });
  const mortality = [];
  for (const age of mortalityAges) {
    for (const sex of ['K','M']) {
      const r = data.mortalityRisks.find(x =>
        x.geo === geo && +x.window === +window && x.year == null &&
        +x.age === age && x.sex === sex
      );
      mortality.push(r ? {
        age, sex,
        localWeight: round1((r.cellLocalWeight || 0) * 100),
        averageAnnualExposure: r.cellAverageAnnualExposure ?? null,
        expectedEvents: r.cellExpectedEvents ?? null,
        nationalHazard: r.nationalHazard ?? null,
        modelRisk: r.value ?? null,
        rawCellFactor: r.rawCellFactor ?? null
      } : {age,sex,localWeight:null});
    }
  }
  return {fertility, mortality};
}


const parameterSummary = {};
for (const geo of TARGET_GEOS) {
  parameterSummary[geo] = {};
  for (const window of WINDOWS) {
    const fert = data.fertilityRates.filter(r => r.geo === geo && +r.window === window);
    const mort = data.mortalityRisks.filter(r => r.geo === geo && +r.window === window);
    const migrationWindow = MIGRATION_WINDOWS.includes(window) ? window : 10;
    const mig = data.netMigration.filter(r => r.geo === geo && +r.window === migrationWindow);
    parameterSummary[geo][window] = {
      fertilityProfileRows: fert.length,
      fertilityRateSum: round1(sum(fert, r => r.value)),
      mortalityProfileRows: mort.length,
      migrationWindowUsed: migrationWindow,
      migrationProfileRows: mig.length,
      annualNetMigrationProfileSum: round1(sum(mig, r => r.value))
    };
  }
}

const warnings = [];
if (Math.abs(faDifference) > 0.5) {
  warnings.push(`FA base population differs from municipal sum by ${faDifference} persons.`);
}
if (Object.values(faForecastConsistency).some(x => !x.ok)) {
  warnings.push(
    'FA forecast differs from the sum of municipal forecasts; maximum difference ' +
    maxForecastDifference + ' persons.'
  );
}
if (data.parameters && data.parameters.sexRatioMaleAtBirthSource) {
  warnings.push(
    'Birth sex ratio source: ' +
    data.parameters.sexRatioMaleAtBirthSource +
    '. Observed FA share is retained only as a diagnostic.'
  );
}
warnings.push(
  'Future fertility/mortality mode: ' +
  (data.parameters?.futureNationalProfileMode || 'unknown') +
  '. Net migration remains locally calibrated in V1.'
);

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
    forecastWindows: faForecastConsistency,
    maxForecastDifference,
    ok: Math.abs(faDifference) <= 0.5 &&
      Object.values(faForecastConsistency).every(x => x.ok)
  },
  parameterSummary,
  relativeFactors,
  fadingExamples: Object.fromEntries(
    TARGET_GEOS.map(geo => [
      geo,
      Object.fromEntries(WINDOWS.map(w => [w, fadingExamplesFor(geo, w)]))
    ])
  ),
  forecasts,
  fertilitySensitivity,
  migrationSensitivity,
  migrationLegWindowDiagnostic,
  warnings
};

const out = path.join(ROOT, 'data', 'model_validation.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8');
fs.writeFileSync(
  path.join(ROOT, 'data', 'model_validation.js'),
  'window.MODEL_VALIDATION = ' + JSON.stringify(report) + ';\n',
  'utf8'
);

console.log(`Wrote data/model_validation.json and data/model_validation.js`);
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
