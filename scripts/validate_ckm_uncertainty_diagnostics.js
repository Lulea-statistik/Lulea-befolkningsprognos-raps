#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const ROOT=path.resolve(__dirname,'..');
global.window={};
vm.runInThisContext(fs.readFileSync(path.join(ROOT,'js','model.js'),'utf8'));
const M=window.RAPSModel;
const data=JSON.parse(fs.readFileSync(path.join(ROOT,'data','model_data.json'),'utf8'));
const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'data','ckm_uncertainty_diagnostics_config.json'),'utf8'));

const delta=Number(cfg.cellDelta);
const checks={};
checks.deltaMatchesCalibration=Number(data.calibration?.ckmCellDelta)===delta;

const cells=[
  [0,100],[1,100],[3,100],[10,100],[50,1000],[200,10000]
];
checks.boundsOrdered=cells.every(([events,exposure])=>{
  const b=M.ckmRiskBounds(events,exposure,delta);
  return [b.low,b.base,b.high].every(Number.isFinite) &&
    b.low>=0 && b.base>=0 && b.high>=0 &&
    b.low<=b.base+1e-15 && b.base<=b.high+1e-15;
});

const relSmall=M.ckmMaxRelativePct(10,delta);
const relLarge=M.ckmMaxRelativePct(1000,delta);
checks.fixedDeltaRelativeImpactFallsWithCount=
  Number.isFinite(relSmall)&&Number.isFinite(relLarge)&&relLarge<relSmall;

const zero=M.ckmRiskBounds(0,0,delta);
checks.zeroCellFiniteNonnegative=
  [zero.low,zero.base,zero.high].every(v=>Number.isFinite(v)&&v>=0);

checks.methodBreakExplicit=
  Number(data.meta?.methodBreakYear)===2025 &&
  /CKM/i.test(String(data.meta?.methodBreak||''));

checks.ckmDiagnosticsPresent=
  Array.isArray(data.diagnostics?.ckm) && data.diagnostics.ckm.length>0;

checks.preCkmCalibrationStopsAt2024=
  Number(data.calibration?.preCkmEnd)===2024 &&
  Number(data.calibration?.ckmStart)===2025;

checks.uncertaintyNoteNotConfidenceInterval=
  /not statistical confidence intervals/i.test(
    String(data.diagnostics?.migrationUncertaintyNote||'')
  );

const allPassed=Object.values(checks).every(Boolean);
const out={
  schemaVersion:'0.1.0',
  status:allPassed?'production_diagnostic_validated':'validation_failed',
  allPassed,checks,cellDelta:delta,
  examples:{smallCountRelativePct:relSmall,largeCountRelativePct:relLarge},
  note:'CKM sensitivity diagnostics only; not statistical confidence intervals and not calibration inputs.'
};
const outPath=path.join(ROOT,'data','backtests','ckm_uncertainty_diagnostics_validation.json');
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n','utf8');
console.log(JSON.stringify(out,null,2));
if(!allPassed) process.exit(1);
