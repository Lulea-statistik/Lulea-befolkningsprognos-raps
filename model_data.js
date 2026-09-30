window.MODEL_DATA = {
  meta: {
    schemaVersion: "0.1.0",
    generated: null,
    dataReady: false,
    baseYear: 2025,
    methodBreakYear: 2025,
    methodBreak: "SCB Cell Key Method (CKM)",
    note: "Strukturfil. Kör scripts/scb_v2_client.py och senare transformering för att fylla med officiella data."
  },
  geographies: [
    {code:"FA_LULEA", name:"Luleå FA", members:["2580","2582","2581","2560","2514"]},
    {code:"2580", name:"Luleå kommun"},
    {code:"2582", name:"Bodens kommun"},
    {code:"2581", name:"Piteå kommun"},
    {code:"2560", name:"Älvsbyns kommun"},
    {code:"2514", name:"Kalix kommun"}
  ],
  calibration: {defaultYears:10, options:[6,10,19], preCkmEnd:2024, ckmStart:2025, ckmCellDelta:3},
  parameters: {
    qutbMode:"identity",
    endogenousInMigration:false,
    endogenousOutMigration:false,
    iflMode:"deferred",
    sexRatioMaleAtBirth:0.515
  },
  sources: [
    {key:"population_pre2025", query:"Folkmängden efter region civilstånd ålder och kön 1968 2024", method:"pre_CKM"},
    {key:"population_2025", query:"Folkmängden efter region civilstånd ålder och kön 2025", alias:"BefolkningCKM", method:"CKM"},
    {key:"mean_population_pre2025", query:"Medelfolkmängd efter födelseår region ålder kön", method:"pre_CKM"},
    {key:"mean_population_2025", query:"Medelfolkmängd efter födelseår region ålder kön 2025", alias:"MedelfolkFodarCKM", method:"CKM"},
    {key:"migration_pre2025", query:"Flyttningar efter region ålder och kön 1997 2024", method:"pre_CKM"},
    {key:"migration_2025", query:"Flyttningar efter region ålder och kön 2025", alias:"Flyttningar97CKM", method:"CKM"},
    {key:"births_pre2025", query:"Födda efter region moderns ålder barnets kön 1968 2024", method:"pre_CKM"},
    {key:"births_2025", query:"Födda efter region moderns ålder barnets kön 2025", alias:"FoddaKCKM", method:"CKM"},
    {key:"deaths_pre2025", query:"Döda efter region ålder kön 1968 2024", method:"pre_CKM"},
    {key:"fertility_forecast", query:"Fruktsamhetstal prognos födelseregion ålder 2026 2120"},
    {key:"mortality_forecast", query:"Dödstal prognos födelseregion kön ålder 2026 2120"}
  ],
  // Filled later by transform script.
  populationBase: [],
  fertilityRates: [],
  mortalityRisks: [],
  netMigration: [],
  diagnostics: {ckm:[]}
};
