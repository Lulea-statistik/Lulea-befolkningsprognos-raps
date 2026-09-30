window.MODEL_VALIDATION = {
  "generatedBy": "scripts/validate_model.js",
  "modelSchemaVersion": "0.5.0",
  "baseYear": 2025,
  "endYear": 2050,
  "basePopulation": {
    "2514": 15272,
    "2560": 7846,
    "2580": 80321,
    "2581": 42203,
    "2582": 28652,
    "FA_LULEA": 174294
  },
  "faConsistency": {
    "faPopulation": 174294,
    "municipalSum": 174294,
    "difference": 0,
    "ok": true
  },
  "parameterSummary": {
    "2514": {
      "6": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 46.2,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": -18.8
      },
      "10": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 45.1,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 1
      },
      "19": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 43.8,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": -27.4
      }
    },
    "2560": {
      "6": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 44.2,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": -30.3
      },
      "10": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 43.3,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": -8.6
      },
      "19": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 41.4,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": -13.8
      }
    },
    "2580": {
      "6": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 38.3,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 321.5
      },
      "10": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 38.1,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 346.5
      },
      "19": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 38.6,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 280.6
      }
    },
    "2581": {
      "6": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 42.5,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 113
      },
      "10": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 41.6,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 147.1
      },
      "19": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 40.5,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 117.5
      }
    },
    "2582": {
      "6": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 42.8,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 61.7
      },
      "10": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 42.9,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 59.4
      },
      "19": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 41.4,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 40.2
      }
    },
    "FA_LULEA": {
      "6": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 40.8,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 447
      },
      "10": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 40.3,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 545.4
      },
      "19": {
        "fertilityProfileRows": 910,
        "fertilityRateSum": 40,
        "mortalityProfileRows": 5252,
        "migrationProfileRows": 202,
        "annualNetMigrationProfileSum": 397.1
      }
    }
  },
  "relativeFactors": {
    "fertility": [
      {
        "geo": "2580",
        "window": 6,
        "raw": 0.9207357815517265,
        "applied": 0.9207357815517265,
        "observedBirths": 4232,
        "expectedBirthsAtNationalRates": 4596.3240321428175,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2582",
        "window": 6,
        "raw": 1.0378037553032766,
        "applied": 1.0378037553032766,
        "observedBirths": 1511,
        "expectedBirthsAtNationalRates": 1455.9592719516047,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2581",
        "window": 6,
        "raw": 1.0313117335442765,
        "applied": 1.0313117335442765,
        "observedBirths": 2353,
        "expectedBirthsAtNationalRates": 2281.56038903341,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2560",
        "window": 6,
        "raw": 1.0806204446847367,
        "applied": 1.0806204446847367,
        "observedBirths": 432,
        "expectedBirthsAtNationalRates": 399.7703376101059,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2514",
        "window": 6,
        "raw": 1.1397013068505828,
        "applied": 1.1397013068505828,
        "observedBirths": 781,
        "expectedBirthsAtNationalRates": 685.2672672265267,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "FA_LULEA",
        "window": 6,
        "raw": 0.9883339332465928,
        "applied": 0.9883339332465928,
        "observedBirths": 9309,
        "expectedBirthsAtNationalRates": 9418.881297964472,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2580",
        "window": 10,
        "raw": 0.9137286079496361,
        "applied": 0.9137286079496361,
        "observedBirths": 7287,
        "expectedBirthsAtNationalRates": 7975.01570663491,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2582",
        "window": 10,
        "raw": 1.0409879452147217,
        "applied": 1.0409879452147217,
        "observedBirths": 2628,
        "expectedBirthsAtNationalRates": 2524.524911244702,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2581",
        "window": 10,
        "raw": 1.0080976484345114,
        "applied": 1.0080976484345114,
        "observedBirths": 3981,
        "expectedBirthsAtNationalRates": 3949.0222065115904,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2560",
        "window": 10,
        "raw": 1.0580876390188467,
        "applied": 1.0580876390188467,
        "observedBirths": 735,
        "expectedBirthsAtNationalRates": 694.6494533114077,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2514",
        "window": 10,
        "raw": 1.1075045144426172,
        "applied": 1.1075045144426172,
        "observedBirths": 1319,
        "expectedBirthsAtNationalRates": 1190.9657999577762,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "FA_LULEA",
        "window": 10,
        "raw": 0.9764801096306273,
        "applied": 0.9764801096306273,
        "observedBirths": 15950,
        "expectedBirthsAtNationalRates": 16334.178077660385,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2580",
        "window": 19,
        "raw": 0.9240692802420388,
        "applied": 0.9240692802420388,
        "observedBirths": 14348,
        "expectedBirthsAtNationalRates": 15526.974337077701,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2582",
        "window": 19,
        "raw": 1.0038575266564518,
        "applied": 1.0038575266564518,
        "observedBirths": 4918,
        "expectedBirthsAtNationalRates": 4899.101585043031,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2581",
        "window": 19,
        "raw": 0.979964494439616,
        "applied": 0.979964494439616,
        "observedBirths": 7661,
        "expectedBirthsAtNationalRates": 7817.630172796082,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2560",
        "window": 19,
        "raw": 1.0086199806253813,
        "applied": 1.0086199806253813,
        "observedBirths": 1379,
        "expectedBirthsAtNationalRates": 1367.2146363241482,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "2514",
        "window": 19,
        "raw": 1.0717045317089813,
        "applied": 1.0717045317089813,
        "observedBirths": 2618,
        "expectedBirthsAtNationalRates": 2442.837482291165,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      },
      {
        "geo": "FA_LULEA",
        "window": 19,
        "raw": 0.9647542666914116,
        "applied": 0.9647542666914116,
        "observedBirths": 30924,
        "expectedBirthsAtNationalRates": 32053.758213532128,
        "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile"
      }
    ],
    "mortality": [
      {
        "geo": "2580",
        "window": 6,
        "raw": 1.0581474377635784,
        "applied": 1.0581474377635784,
        "observedDeaths": 4519,
        "expectedDeathsAtNationalRates": 4270.671400529043,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2582",
        "window": 6,
        "raw": 1.0930332265950087,
        "applied": 1.0930332265950087,
        "observedDeaths": 1972,
        "expectedDeathsAtNationalRates": 1804.1537549074587,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2581",
        "window": 6,
        "raw": 1.1277645085223482,
        "applied": 1.1277645085223482,
        "observedDeaths": 2767,
        "expectedDeathsAtNationalRates": 2453.5264047504543,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2560",
        "window": 6,
        "raw": 1.1205634583826594,
        "applied": 1.1205634583826594,
        "observedDeaths": 634,
        "expectedDeathsAtNationalRates": 565.7867881173548,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2514",
        "window": 6,
        "raw": 1.1640346444167489,
        "applied": 1.1640346444167489,
        "observedDeaths": 1370,
        "expectedDeathsAtNationalRates": 1176.9409154368013,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "FA_LULEA",
        "window": 6,
        "raw": 1.09647678796103,
        "applied": 1.09647678796103,
        "observedDeaths": 11262,
        "expectedDeathsAtNationalRates": 10271.079263741116,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2580",
        "window": 10,
        "raw": 1.0403842851951046,
        "applied": 1.0403842851951046,
        "observedDeaths": 7261,
        "expectedDeathsAtNationalRates": 6979.151937726871,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2582",
        "window": 10,
        "raw": 1.066989889441626,
        "applied": 1.066989889441626,
        "observedDeaths": 3184,
        "expectedDeathsAtNationalRates": 2984.0957552711593,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2581",
        "window": 10,
        "raw": 1.1425722888854215,
        "applied": 1.1425722888854215,
        "observedDeaths": 4604,
        "expectedDeathsAtNationalRates": 4029.5043427765945,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2560",
        "window": 10,
        "raw": 1.1260854063310746,
        "applied": 1.1260854063310746,
        "observedDeaths": 1076,
        "expectedDeathsAtNationalRates": 955.5225509100069,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2514",
        "window": 10,
        "raw": 1.178447033479644,
        "applied": 1.178447033479644,
        "observedDeaths": 2290,
        "expectedDeathsAtNationalRates": 1943.2354063790483,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "FA_LULEA",
        "window": 10,
        "raw": 1.0901926475230406,
        "applied": 1.0901926475230406,
        "observedDeaths": 18415,
        "expectedDeathsAtNationalRates": 16891.50999306369,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2580",
        "window": 19,
        "raw": 1.027523306133498,
        "applied": 1.027523306133498,
        "observedDeaths": 12967,
        "expectedDeathsAtNationalRates": 12619.665094307164,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2582",
        "window": 19,
        "raw": 1.0644855753264977,
        "applied": 1.0644855753264977,
        "observedDeaths": 5950,
        "expectedDeathsAtNationalRates": 5589.554370593536,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2581",
        "window": 19,
        "raw": 1.1339114276671547,
        "applied": 1.1339114276671547,
        "observedDeaths": 8408,
        "expectedDeathsAtNationalRates": 7415.04124118243,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2560",
        "window": 19,
        "raw": 1.092487355308765,
        "applied": 1.092487355308765,
        "observedDeaths": 2026,
        "expectedDeathsAtNationalRates": 1854.4837065207041,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "2514",
        "window": 19,
        "raw": 1.1501140867834723,
        "applied": 1.1501140867834723,
        "observedDeaths": 4252,
        "expectedDeathsAtNationalRates": 3697.024537706152,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      },
      {
        "geo": "FA_LULEA",
        "window": 19,
        "raw": 1.0778563330244972,
        "applied": 1.0778563330244972,
        "observedDeaths": 33603,
        "expectedDeathsAtNationalRates": 31175.76895030989,
        "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile"
      }
    ],
    "bounds": {
      "min": 0.5,
      "max": 1.5
    },
    "method": "Observed / expected at national age-specific rates",
    "fallbackFading": {
      "enabledOnlyWhenOfficialRapsParameterUnavailable": true,
      "maxLocalWeight": 0.25,
      "halfSaturationExpectedEvents": 20,
      "formula": "generalFactor=observed/expected; w=maxLocalWeight*Ecell/(Ecell+halfSaturation); cellRate=(1-w)*(nationalRate*generalFactor)+w*localCellRate"
    }
  },
  "forecasts": {
    "2514": {
      "6": {
        "startPopulation": 15272,
        "endPopulation": 12054.9,
        "change": -3217.1,
        "changePct": -21.1,
        "cumulativeBirths": 2502.2,
        "cumulativeDeaths": 5248.5,
        "cumulativeNetMigration": -470.8,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": -598.4,
        "differenceVs10YearEndPct": -4.7
      },
      "10": {
        "startPopulation": 15272,
        "endPopulation": 12653.3,
        "change": -2618.7,
        "changePct": -17.1,
        "cumulativeBirths": 2653.2,
        "cumulativeDeaths": 5296.9,
        "cumulativeNetMigration": 25,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": 0,
        "differenceVs10YearEndPct": 0
      },
      "19": {
        "startPopulation": 15272,
        "endPopulation": 11647.1,
        "change": -3624.9,
        "changePct": -23.7,
        "cumulativeBirths": 2335,
        "cumulativeDeaths": 5274.5,
        "cumulativeNetMigration": -685.5,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": -1006.2,
        "differenceVs10YearEndPct": -8
      }
    },
    "2560": {
      "6": {
        "startPopulation": 7846,
        "endPopulation": 6093.4,
        "change": -1752.6,
        "changePct": -22.3,
        "cumulativeBirths": 1437.3,
        "cumulativeDeaths": 2431.6,
        "cumulativeNetMigration": -758.3,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": -558.8,
        "differenceVs10YearEndPct": -8.4
      },
      "10": {
        "startPopulation": 7846,
        "endPopulation": 6652.2,
        "change": -1193.8,
        "changePct": -15.2,
        "cumulativeBirths": 1440.5,
        "cumulativeDeaths": 2419.3,
        "cumulativeNetMigration": -215,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": 0,
        "differenceVs10YearEndPct": 0
      },
      "19": {
        "startPopulation": 7846,
        "endPopulation": 6415.9,
        "change": -1430.1,
        "changePct": -18.2,
        "cumulativeBirths": 1294.9,
        "cumulativeDeaths": 2380.3,
        "cumulativeNetMigration": -344.7,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": -236.3,
        "differenceVs10YearEndPct": -3.6
      }
    },
    "2580": {
      "6": {
        "startPopulation": 80321,
        "endPopulation": 86215.4,
        "change": 5894.4,
        "changePct": 7.3,
        "cumulativeBirths": 18574.8,
        "cumulativeDeaths": 20717.8,
        "cumulativeNetMigration": 8037.5,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": -256.1,
        "differenceVs10YearEndPct": -0.3
      },
      "10": {
        "startPopulation": 80321,
        "endPopulation": 86471.5,
        "change": 6150.5,
        "changePct": 7.7,
        "cumulativeBirths": 18039.1,
        "cumulativeDeaths": 20551.1,
        "cumulativeNetMigration": 8662.5,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": 0,
        "differenceVs10YearEndPct": 0
      },
      "19": {
        "startPopulation": 80321,
        "endPopulation": 84731.3,
        "change": 4410.3,
        "changePct": 5.5,
        "cumulativeBirths": 17854.7,
        "cumulativeDeaths": 20458.9,
        "cumulativeNetMigration": 7014.5,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": -1740.2,
        "differenceVs10YearEndPct": -2
      }
    },
    "2581": {
      "6": {
        "startPopulation": 42203,
        "endPopulation": 41802.2,
        "change": -400.8,
        "changePct": -0.9,
        "cumulativeBirths": 9144,
        "cumulativeDeaths": 12369.8,
        "cumulativeNetMigration": 2825,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": -376.7,
        "differenceVs10YearEndPct": -0.9
      },
      "10": {
        "startPopulation": 42203,
        "endPopulation": 42178.9,
        "change": -24.1,
        "changePct": -0.1,
        "cumulativeBirths": 8817.7,
        "cumulativeDeaths": 12519.3,
        "cumulativeNetMigration": 3677.5,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": 0,
        "differenceVs10YearEndPct": 0
      },
      "19": {
        "startPopulation": 42203,
        "endPopulation": 40936.4,
        "change": -1266.6,
        "changePct": -3,
        "cumulativeBirths": 8363.6,
        "cumulativeDeaths": 12568.4,
        "cumulativeNetMigration": 2938.2,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": -1242.5,
        "differenceVs10YearEndPct": -2.9
      }
    },
    "2582": {
      "6": {
        "startPopulation": 28652,
        "endPopulation": 27537.5,
        "change": -1114.5,
        "changePct": -3.9,
        "cumulativeBirths": 5750.8,
        "cumulativeDeaths": 8406.9,
        "cumulativeNetMigration": 1541.7,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": 33.6,
        "differenceVs10YearEndPct": 0.1
      },
      "10": {
        "startPopulation": 28652,
        "endPopulation": 27503.9,
        "change": -1148.1,
        "changePct": -4,
        "cumulativeBirths": 5725,
        "cumulativeDeaths": 8358.2,
        "cumulativeNetMigration": 1485,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": 0,
        "differenceVs10YearEndPct": 0
      },
      "19": {
        "startPopulation": 28652,
        "endPopulation": 26647,
        "change": -2005,
        "changePct": -7,
        "cumulativeBirths": 5332.5,
        "cumulativeDeaths": 8341.5,
        "cumulativeNetMigration": 1003.9,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": -856.9,
        "differenceVs10YearEndPct": -3.1
      }
    },
    "FA_LULEA": {
      "6": {
        "startPopulation": 174294,
        "endPopulation": 173871.8,
        "change": -422.2,
        "changePct": -0.2,
        "cumulativeBirths": 37606.3,
        "cumulativeDeaths": 49203.5,
        "cumulativeNetMigration": 11175,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": -1641.1,
        "differenceVs10YearEndPct": -0.9
      },
      "10": {
        "startPopulation": 174294,
        "endPopulation": 175512.9,
        "change": 1218.9,
        "changePct": 0.7,
        "cumulativeBirths": 36777.5,
        "cumulativeDeaths": 49193.7,
        "cumulativeNetMigration": 13635,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": 0,
        "differenceVs10YearEndPct": 0
      },
      "19": {
        "startPopulation": 174294,
        "endPopulation": 170416.7,
        "change": -3877.3,
        "changePct": -2.2,
        "cumulativeBirths": 35263.9,
        "cumulativeDeaths": 49067.5,
        "cumulativeNetMigration": 9926.3,
        "cumulativeScenarioEffect": 0,
        "differenceVs10YearEnd": -5096.2,
        "differenceVs10YearEndPct": -2.9
      }
    }
  },
  "warnings": [
    "Birth sex ratio source: Raps technical specification: 0.515 boys / 0.485 girls. Observed FA share is retained only as a diagnostic.",
    "Future fertility/mortality mode: SCB 2024 annual national profiles × local relative shape. Net migration remains locally calibrated in V1."
  ]
};
