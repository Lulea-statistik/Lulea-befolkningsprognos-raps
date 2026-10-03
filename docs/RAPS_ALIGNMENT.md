# Raps alignment, small-number handling and benchmarks

## Principle

The project follows documented Raps methodology wherever the public documentation is explicit. A separate fallback method may be used only where the official parameter data, cluster assignment, or coefficient tables are unavailable.

Backtests and external benchmarks are evaluation tools. They must not be used to tune parameters after the historical outcome is known. Any fallback thresholds or weighting functions are fixed before evaluation and documented here.

## What documented Raps does for small numbers

### Fertility
Raps groups municipalities into fertility types and uses smoothing/replacement rules when the number of observations is too small. Where the official cluster/parameter data are available, those rules take precedence over this project's fallback.

### Mortality
Raps groups municipalities by observed deaths relative to the number expected under national age/sex mortality risks. The same observed/expected logic is used here for the broad municipality level.

### Out-migration
Raps uses municipality types and multi-year smoothing for out-migration risks. V1 still uses locally calibrated exogenous net migration while IMIG/UMIG coefficients are deferred.

### Migration candidate used for development
The public Raps technical specification models both in-migration and out-migration as population shares transformed with a logit and then explained by lagged migration and regional covariates such as employment, unemployment, housing prices and immigration. Those equations require coefficient tables and explanatory inputs that are not yet available in this repository.

The project therefore does **not** label the current development alternative as full IMIG/UMIG. Instead, a fixed ex-ante gross-flow candidate is evaluated:

    gross_in(a,s) = historical annual mean municipal in-migration
    gross_out(a,s,t) = urisk(a,s) * current population(a,s,t)
    net_migration = gross_in - gross_out

The candidate uses the same 6- and 10-year calibration windows as the historical backtest. It is compared side by side with the published V1 exogenous net-migration baseline. Its parameters must not be tuned to improve the already-known 2022-2024 outcome.

Municipal gross flows include moves between municipalities inside Lulea FA. They are therefore valid municipal diagnostics but must not be presented as external FA gross flows. The published FA forecast remains the additive sum of municipal forecasts.

Reference: Tillväxtverket, *Raps Teknisk modellspecifikation*, sections 1.2.1-1.2.2.

## Informationsvägd reservutjämning mot riksprofilen

The fallback method uses information-weighted partial smoothing toward the national age profile rather than a hard switch between national and local age-specific data.

First calculate a broad age-standardized municipality/FA factor:

    general_factor = observed_total / expected_total_at_national_rates

The broad factor describes whether the municipality is generally above or below Sweden after controlling for age/sex structure.

For each maternal-age fertility cell or age/sex mortality cell, the local weight is based on two ex-ante information signals. It does not depend on forecast errors or on whether the local outcome happens to fit a benchmark.

Signal 1: average annual local population/exposure in the cell.

- <= 20: 0 % exposure weight
- >= 100: 100 % exposure weight
- between 20 and 100: cubic smoothstep

Signal 2: expected number of events under national rates over the calibration window.

- <= 1 expected event: 0 % event weight
- >= 20 expected events: 100 % event weight
- between 1 and 20: cubic smoothstep

The final local cell weight is:

    w = exposure_weight * event_weight

This reconciles two requirements: a sufficiently large and information-rich cell can become 100 % local, while a rare-event cell such as births to 15-year-olds can remain close to the national age pattern even if its population denominator is not tiny.

The base cell rate is:

    national_rate_cell * general_factor

and the final cell rate is:

    final_cell_rate = (1 - w) * base_cell_rate + w * local_cell_rate

This means large, well-populated cells can be fully local while small cells remain on the national age pattern. The smooth transition removes an abrupt cutoff.

Safety bounds for local/national ratios remain 0.50 to 1.50 until official Raps cluster parameters replace the fallback.

## Anti-overfitting rule

The information-weighting thresholds, ratio bounds, calibration windows and model equations are fixed before benchmark evaluation. A poor backtest may identify a model weakness, but the same historical backtest must not then be used to choose parameters that improve that known result.

Changes motivated by a backtest must be based on an independent methodological reason and should subsequently be evaluated on another holdout period or future data.

## Benchmark hierarchy

1. Same-year, same-geography SCB regional projection as an alternative methodology benchmark.
2. Current Tillvaxtverket/Raps scenario assumptions for national and county-level context.
3. Historical out-of-sample backtests using only information that existed at the forecast origin.
4. Historical published Raps handbook model runs as regression references.
5. A licensed/exported Raps DB25 baseline for Lulea or the selected FA region becomes the preferred direct Raps benchmark if obtained.

Reference data are stored under:

    data/benchmarks/

Historical holdout tests are stored under:

    data/backtests/
