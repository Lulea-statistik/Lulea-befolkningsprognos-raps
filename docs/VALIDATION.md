# Validation and benchmark strategy

The model is validated in three complementary ways.

## 1. Raps alignment

Use documented Raps methodology and scenario assumptions wherever available. Where official Raps cluster/parameter data are unavailable, use the documented fallback fading method and expose the applied weight in diagnostics.

## 2. SCB regional projection benchmark

SCB TAB6008 is treated as an external alternative benchmark, not as a target the model must reproduce.

Two comparisons are stored:
- raw SCB regional projection,
- SCB trajectory rebased to the model's observed 2025 starting population.

This separates differences in starting level from differences in projected trajectory.

## 3. Historical out-of-sample backtest

Primary short-term backtest:

- calibration information cutoff: 2021,
- forecast years: 2022-2024,
- 2025 excluded from the primary score because of the CKM method break,
- calibration windows: 6 and 10 years.

For each municipality and Lulea FA, compare:

- population level,
- births,
- deaths,
- net migration.

Reported metrics include population MAE/MAPE, 2024 population error, and MAE for births, deaths and net migration.

The backtest is deliberately short-horizon because demographic forecasts are generally most informative at shorter horizons and because long-horizon deviations increasingly reflect structural changes that were not knowable at the forecast origin.

Generated files:
- data/backtests/model_2022_input.json
- data/backtests/actual_2022_2024.json
- data/backtests/backtest_2022_2024.json
- data/benchmarks/scb_regional_projection_normalized.json
- data/benchmarks/scb_model_comparison.json

### Migration alternative within the development backtest

The backtest also reports a **gross-flow candidate** alongside the unchanged V1 net-migration baseline. The candidate uses historical mean gross in-migration and a population-responsive historical out-migration risk (`urisk`). It is a diagnostic intermediate model, not a reproduction of the full Raps IMIG/UMIG equations.

For municipalities, the report compares population MAPE/MAE, net-migration MAE and, where available, gross in- and out-migration MAE. For Lulea FA, municipal results are aggregated additively, but municipal gross flows are not reported as FA external gross migration because internal FA moves would be double-counted.

The 2022-2024 period must not be used to tune this candidate after inspection. A later rolling-origin or independent holdout remains required before any change of default migration engine.

#### First development-backtest result

The first fixed-specification comparison was run without tuning the gross-flow candidate to the observed 2022-2024 outcome. It performed worse than the existing net-migration baseline for every municipality and for both 6- and 10-year calibration windows.

For Lulea municipality with the 10-year window:
- population MAPE: **0.4% net baseline vs 0.8% gross-flow candidate**,
- net-migration MAE: **93.9 vs 134.2 persons/year**,
- 2024 population error: **+450.4 vs +888.4 persons**.

For additive Lulea FA with the 10-year window:
- population MAPE: **0.5% vs 1.0%**,
- net-migration MAE: **278.1 vs 514.2 persons/year**,
- 2024 population error: **+1231.1 vs +2406.1 persons**.

The candidate is therefore retained only as a diagnostic comparison. The V1 exogenous net-migration engine remains the default. The candidate must not now be retuned against 2022-2024; the next migration-method improvement should come from independent methodology or official Raps coefficient/input data.


## Development-backtest status after model v1.6

The 2022-2024 results were inspected before the v1.6 exposure-based fading rule was adopted. Therefore this period is no longer treated as a statistically clean holdout for evaluating that new rule.

The 2022-2024 test remains useful for diagnostics and component-level error analysis, but the v1.6 fading thresholds (20 and 100 local exposure units) must not be changed in response to the rerun of the same period.

A later independent validation should use a different historical forecast origin, a rolling-origin design, or genuinely future observations that were not available when the v1.6 rule was fixed.

## Rolling-origin validation

A second validation layer uses four historical forecast origins: **2018, 2019, 2020 and 2021**. For each origin:

- local calibration uses observations only through the origin year,
- the national fertility/mortality trajectory uses the SCB forecast vintage from that same year,
- the model is evaluated for horizons 1, 2 and 3 years ahead,
- calibration windows 6 and 10 years are scored separately.

The historical SCB vintages are:

- 2018: detailed national forecast `TAB2895`, births `TAB2902`,
- 2019: detailed national forecast `TAB5381`, births `TAB5331`,
- 2020: detailed national forecast `TAB643`, births `TAB647`,
- 2021: detailed national forecast `TAB5946`, births `TAB5948`.

The generated report is `data/backtests/rolling_2018_2024.json/js`. Intermediate per-origin model inputs are generated during the workflow under `data/backtests/rolling_work/` but are not versioned.

Because the forecast windows overlap in calendar time, pooled rolling-origin errors are a robustness diagnostic rather than four statistically independent experiments. The report therefore also preserves origin-specific and forecast-horizon-specific errors.

### National forecast-vintage diagnostic

The rolling-origin report also compares each historical SCB national forecast vintage directly with the later realized Sweden totals for births and deaths. This check is performed **before** local municipal calibration.

Its purpose is diagnostic: if a municipality-level mortality bias has the same sign as the national SCB vintage error, part of the local error may originate in the national forecast assumption rather than the localization method. Conversely, a large municipal bias when the national vintage is close to the observed national total points more strongly toward local calibration, age structure, or simulation mechanics.

This diagnostic must not be used to retroactively scale historical vintages to their known outcomes.

### Mortality localization diagnostic

The rolling-origin report also runs a **national-only mortality alternative**. It applies the same vintage-correct SCB national age/sex mortality hazard to each municipality without the locally calibrated mortality multiplier. Fertility, migration and all other model settings are left unchanged.

The comparison reports deaths MAE/mean error and population MAPE/mean error for:
- the production localization method,
- the national-only alternative.


### Event-age cohort-timing diagnostic

SCB's birth-year mean-population table is explicitly constructed for events classified by attained age at the end of the year. The V1 engine, however, historically applied mortality to the previous 31 December age before ageing the cohort. The rolling-origin report therefore evaluates a fixed, source-definition candidate:

1. age the previous 31 December population one year;
2. calculate births from women at their forecast-year/event age;
3. add newborns at age 0;
4. apply mortality using the forecast-year age, including infant mortality at age 0;
5. apply migration and scenarios on the resulting forecast-year age structure.

This specification is defined from the source age convention and is not tuned to the validation outcome. The production baseline remains unchanged until the rolling-origin comparison has been reviewed. If adopted later, the same timing must be used consistently in production, backtests and scenarios.

It also records the general local mortality factor that was available at each forecast origin. This is an attribution diagnostic, not a new default model. If national-only materially removes a persistent local deaths bias across several origins, the next methodological work should focus on the local mortality calibration/fading rule rather than modifying the national SCB trajectory. The alternative must not be selected merely because it fits these already observed years better.
