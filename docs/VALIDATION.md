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
