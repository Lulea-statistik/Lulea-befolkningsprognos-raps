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
function runGeo(model, actual, geo, window, timingMode) {
  const pred = M.simulate(model, {
    geo,
    endYear: actual.endYear,
    fertMult: 1,
    mortMult: 1,
    migMult: 1,
    window,
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
    memberSummary:{}
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
for (const [code,region] of Object.entries(report.regions)) {
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
