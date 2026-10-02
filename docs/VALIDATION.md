# Validation and benchmark strategy

The model is validated in three complementary ways.

## 1. Raps alignment

Use documented Raps methodology and scenario assumptions wherever available. Where official Raps cluster/parameter data are unavailable, use the documented fallback fading method and expose the applied weight in diagnostics.

## 2. SCB regional projection benchmark

SCB TAB6008 is treated as an external alternative benchmark, not as a target the model must reproduce.

The same principle applies to later SCB national demographic assumptions: a newer SCB trajectory may be shown as a sensitivity path without replacing the Raps-reference baseline merely because it produces a result closer to SCB's regional benchmark.

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

## Forward fertility sensitivity

The production baseline keeps the SCB 2024/Raps national fertility path. A separate **SCB 2026 fertility-only sensitivity** is generated from the current SCB national detailed population/deaths table and births-by-maternal-age table. The local historical relative age pattern is held fixed.

The validation report stores, for Luleå municipality and additive Luleå FA with the standard 10-year calibration window:
- end population in 2050,
- cumulative births,
- difference versus the Raps/SCB 2024 baseline,
- selected national TFR values for 2026, 2030, 2040 and 2050.

This comparison is a forward assumption sensitivity, not a historical score and not a reason to calibrate toward SCB's regional projection.

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

### Horizon priority

Forecast quality is judged primarily at **n+1**, with **n+2** as a secondary horizon. **n+3** is retained as a robustness diagnostic rather than a primary decision metric.

The reason is methodological rather than performance-driven: as the horizon lengthens, a larger share of forecast error can arise from demographic, economic, migration, housing and establishment shocks that were not observable at the forecast origin. The model input remains vintage-correct at all horizons, but short horizons provide the cleanest test of the cohort-component mechanics and source definitions.

For method comparisons, the report therefore exposes population MAPE/MAE, births error, deaths MAE/bias and migration MAE separately for n+1 and n+2. Pooled 1–3 year metrics remain supplementary.

### National forecast-vintage diagnostic

The rolling-origin report also compares each historical SCB national forecast vintage directly with the later realized Sweden totals for births and deaths. This check is performed **before** local municipal calibration.

Its purpose is diagnostic: if a municipality-level mortality bias has the same sign as the national SCB vintage error, part of the local error may originate in the national forecast assumption rather than the localization method. Conversely, a large municipal bias when the national vintage is close to the observed national total points more strongly toward local calibration, age structure, or simulation mechanics.

This diagnostic must not be used to retroactively scale historical vintages to their known outcomes.

### Mortality localization diagnostic

The rolling-origin report also runs a **national-only mortality alternative**. It applies the same vintage-correct SCB national age/sex mortality hazard to each municipality without the locally calibrated mortality multiplier. Fertility, migration and all other model settings are left unchanged.

The comparison reports deaths MAE/mean error and population MAPE/mean error for:
- the production localization method,
- the national-only alternative.


## External FA reference validation

To test whether the method generalizes beyond Luleå, three reference regions are fixed **before** their results are inspected. The validation uses the same rolling origins (2018, 2019, 2020, 2021), the same 6- and 10-year calibration windows, the same vintage-correct SCB national assumptions, and no region-specific tuning.

The reference geography uses the **FA15** classification because the selected region codes are FA15 identifiers:

- FA16 Trollhättan-Vänersborg: Sotenäs, Munkedal, Färgelanda, Grästorp, Mellerud, Lysekil, Uddevalla, Vänersborg and Trollhättan.
- FA36 Gävle: Älvkarleby, Ockelbo, Hofors, Gävle and Sandviken.
- FA42 Sundsvall: Ånge, Timrå, Härnösand and Sundsvall.

The memberships are kept fixed across all validation years. They are not redefined from annual commuting flows. Trollhättan-Vänersborg is intentionally retained as an FA15 multicore stress test even though it is no longer a separate FA25 region.

The external report compares the legacy V1 cohort timing with the pre-defined event-age aligned timing candidate at both FA total and member-municipality level. The primary decision metrics are the **n+1** population MAPE/MAE, births MAE, deaths MAE/mean error and migration MAE; the same **n+2** metrics are secondary. The n+3 and pooled 1–3 year results are supplementary robustness diagnostics. This test is confirmatory: region membership and model parameters must not be altered after observing the scores.

Generated output: `data/backtests/reference_fa_rolling.json/js`.

### Event-age cohort-timing diagnostic

SCB's birth-year mean-population table is explicitly constructed for events classified by attained age at the end of the year. The V1 engine, however, historically applied mortality to the previous 31 December age before ageing the cohort. The rolling-origin report therefore evaluates a fixed, source-definition candidate:

1. age the previous 31 December population one year;
2. calculate births from women at their forecast-year/event age;
3. add newborns at age 0;
4. apply mortality using the forecast-year age, including infant mortality at age 0;
5. apply migration and scenarios on the resulting forecast-year age structure.

This specification was defined from the source age convention before the external FA scores were observed and was not tuned to the validation outcome.

### Timing decision after short-horizon validation

After the n+1/n+2 reporting rule was fixed, the event-age specification was evaluated for Luleå and the three pre-defined external FA15 reference regions. With the 10-year calibration window, n+1 deaths MAE changed as follows:

- Luleå municipality: 98.3 → 28.4,
- Luleå FA: 246.1 → 46.2,
- FA16 Trollhättan-Vänersborg: 305.2 → 67.1,
- FA36 Gävle: 201.7 → 51.7,
- FA42 Sundsvall: 190.8 → 76.1.

At n+1 the deaths MAE improved in all 23 member municipalities included across Luleå FA and the three reference FA regions. Population MAE improved in 19 of 23 municipalities, was effectively unchanged in one, and increased modestly in three small municipalities. At the FA-total level population accuracy improved in all four tested regions. The same broad pattern persisted at n+2.

Because the timing change is both source-definition driven and externally robust at the pre-declared short horizons, **event-age-aligned timing is adopted as the production default from model schema 0.9.0**. The legacy V1 timing remains available only for historical comparison. No fading threshold, calibration window, region membership or local parameter was changed in response to these results.

It also records the general local mortality factor that was available at each forecast origin. This is an attribution diagnostic, not a new default model. If national-only materially removes a persistent local deaths bias across several origins, the next methodological work should focus on the local mortality calibration/fading rule rather than modifying the national SCB trajectory. The alternative must not be selected merely because it fits these already observed years better.
