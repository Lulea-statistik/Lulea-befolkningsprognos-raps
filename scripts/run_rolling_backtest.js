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
  eventAgeTimingDiagnostic: {
    note: 'Historical comparison of legacy V1 timing against the production event-age aligned cohort step. Primary evaluation horizon is n+1, secondary is n+2, and n+3 is supplementary robustness only.',
    summary: {}
  },
  migrationWindowDiagnostic: {
    note: 'Migration-only comparison: fertility and mortality are fixed to the 10-year calibration while net migration uses 2, 3, 4, 6 or 10 years. n+1 is primary and n+2 secondary.',
    windows: migrationWindows,
    summary: {}
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
  const s=report.scbRiskFlowDiagnostic.summary[geo];
  console.log(
    `${geo} scb_risk_flow: n+1 migration MAE=${s.oneYear.scbRiskFlow.netMigrationMAE} vs net10=${s.oneYear.net10Baseline.netMigrationMAE} | `+
    `n+1 population MAE=${s.oneYear.scbRiskFlow.populationMAE} vs net10=${s.oneYear.net10Baseline.populationMAE} | `+
    `n+2 migration MAE=${s.twoYear.scbRiskFlow.netMigrationMAE} vs net10=${s.twoYear.net10Baseline.netMigrationMAE}`
  );
}
