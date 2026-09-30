# Raps alignment, small-number handling and benchmarks

## Principle

The project follows documented Raps methodology wherever the public documentation is explicit. A separate fallback method may be used only where the official parameter data, cluster assignment, or coefficient tables are unavailable.

## What documented Raps does for small numbers

### Fertility
Raps groups municipalities into six fertility types. The clustering is based on how observed births differ from the number expected if the municipality had national fertility. Fertility is further differentiated by mother's background and education. Implausible rates based on too few observations are replaced using the same age in other years, and several years are combined with larger weight on recent years.

### Mortality
Raps groups municipalities into four mortality types. The grouping is based on the percentage difference between observed deaths and expected deaths if national age/sex mortality risks had applied. Risks are estimated by age and sex and smoothed across years.

### Out-migration
Raps uses eight municipality types for out-migration. Out-migration risks are estimated from movers and mean population and are smoothed over years. For ages above 80 the documented method imposes an explicit declining risk because observations are too sparse.

## Fallback fading

Until the official Raps parameter/cluster data are wired into this repository, the model uses a continuous shrinkage to the national reference instead of a hard municipality/national cutoff.

For an observed-to-expected local ratio:

    raw_ratio = observed / expected_at_national_rates

the local weight is:

    w = max_local_weight * E / (E + half_saturation)

where E is the expected event count under national rates.

The applied factor is:

    applied_ratio = 1 + w * (raw_ratio - 1)

Default fallback settings:

- maximum local weight: 25 %
- half-saturation: 20 expected events
- ratio safety bounds: 0.50 to 1.50

The use of expected event counts is deliberate. It gives very small weight to rare cells such as births to 15-year-olds even if the population exposure itself is not zero.

This fading is a fallback, not a claim about official Raps. It should be bypassed when the official Raps cluster parameter is available.

## Benchmark hierarchy

1. Same-year, same-geography SCB regional projection used as a Raps scenario reference.
2. Current Tillvaxtverket scenario assumptions for the national and county-level context.
3. Historical published Raps handbook model runs as regression tests of model mechanics.
4. A licensed/exported Raps DB25 baseline for Lulea or the selected FA region, if obtained, becomes the preferred benchmark.

Reference data are stored in:

    data/benchmarks/tillvaxtverket_raps_reference.json


## Age-specific fading around the general municipality ratio

The general municipality/FA factor remains the age-standardized observed-to-expected ratio against Sweden. Age-specific local deviations are then allowed to influence the final profile only gradually.

For fertility by maternal age, and mortality by age/sex:

    general_factor = observed_total / expected_total_at_national_rates
    expected_cell = local_exposure_cell * national_rate_cell
    w_cell = max_local_weight * expected_cell / (expected_cell + half_saturation)

The base cell rate is:

    national_rate_cell * general_factor

and the final cell rate is:

    (1 - w_cell) * base_cell_rate + w_cell * local_cell_rate

Thus a rare cell such as births to 15-year-olds stays almost entirely on the national age pattern, while cells with stronger information can receive up to 25 percent direct local age-specific influence. This avoids a hard cutoff between national and municipal data while preserving the broad municipality-to-Sweden level difference.
