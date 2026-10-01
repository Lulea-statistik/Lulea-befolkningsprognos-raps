# Analysis and evaluation design

## Forecast evaluation

The dashboard should distinguish model evaluation from parameter fitting.

Recommended evaluation views:

1. **Short-horizon backtest**
   - forecast origin fixed in the past,
   - compare forecast with actual population 1–3 years later,
   - show total error, MAE/MAPE and demographic-component errors.

2. **Single-year age errors**
   - show forecast minus actual by age in persons,
   - show percentage error alongside absolute error,
   - avoid treating a large percentage error in a tiny old-age cell as equally important as the same percentage error in a large young-adult cohort.

3. **Component decomposition**
   - births,
   - deaths,
   - domestic migration,
   - international migration where available,
   - identify which component drives the total population error.

4. **Forecast-vintage comparison**
   - compare several historical forecast origins with later actual outcomes,
   - useful for assessing model stability and whether a one-off backtest is representative.

5. **External benchmark**
   - compare with SCB regional projection without forcing the model to match it,
   - show both raw SCB path and a path rebased to the same observed starting population.

6. **Calibration-window sensitivity**
   - 6, 10 and 19 years,
   - treat the spread as model sensitivity, not as a statistical confidence interval.

## Recommended illustrations

- historical population followed by forecast with a clear vertical forecast-start marker,
- age pyramid for base year versus selected future year,
- age-group shares over time,
- demographic dependency ratio,
- births and deaths: historical plus forecast,
- domestic in/out migration and net migration,
- migration by single-year age,
- local-vs-national fading weight by age,
- forecast error by single-year age in both persons and percent,
- scenario minus baseline population effect,
- municipality comparison within Lulea FA.

## Labour market and commuting

SCB TAB1830 contains employed persons aged 15–74 by municipality of residence and municipality of workplace.

Use it to describe:

- job count by workplace municipality,
- job growth over 2020–2024,
- share of workers living in the same municipality,
- share living in other Lulea FA municipalities,
- share living outside Lulea FA,
- commuting matrix between Lulea, Boden, Pitea, Alvsbyn and Kalix,
- allocation of hypothetical new jobs according to observed residence shares.

Do **not** treat commuting as residential migration. A worker can commute for years without moving. For population scenarios:

1. allocate new jobs by observed residence shares,
2. isolate the share currently associated with residents outside FA,
3. apply a separate scenario assumption for how many of those job holders relocate,
4. multiply by persons per relocating job/household if a household effect is desired.

## Interpretation by forecast horizon

Short horizon: use as a forecast and evaluate against actual outcomes.

Long horizon: use primarily as a demographic projection/scenario. Annual peaks and troughs in fertility and migration cannot be forecast precisely many years ahead; long-run assumptions should be interpreted as structural levels/trends.

## Source inspiration

- Västra Götalandsregionen, *Befolkningsprognos 2025–2040*:
  https://mellanarkiv-offentlig.vgregion.se/alfresco/s/archive/stream/public/v1/source/available/sofia/rs7897-268913469-852/surrogate/Befolkningsprognos%202025-2040.pdf
- SCB, population projections and documentation:
  https://www.scb.se/be0401
- SCB, evaluation of regional population projections 2020–2022:
  https://www.scb.se/publikation/51867
- SCB, commuting table TAB1830:
  https://www.statistikdatabasen.scb.se/pxweb/sv/ssd/START__AM__AM0210__AM0210F/ArRegPend2/


## Age/sex profile for job-driven migration

Workplace scenarios now separate three concepts:

1. who holds a new job, estimated from the observed residence distribution of workers in SCB TAB1830;
2. what share of job holders currently outside the FA region is assumed to relocate;
3. the age/sex distribution of the resulting new residents.

The default workplace scenario now separates the moving job holder from additional household members. Up to one person per moving job follows a worker-specific hybrid profile based on SCB TAB3205 workplace employment age/sex shares. Within each broad worker group, observed municipal in-migration is used only to distribute the group across single-year ages. Additional persons per job follow a separate household-companion proxy based on observed in-migration ages 0-17 and 25-64.

Alternative dashboard modes retain the earlier 0-64 observed-inflow profile, all observed in-migrant ages, or the old population-proportional allocation for sensitivity comparison. All profiles are descriptive scenario priors, not causal estimates of job-induced migration.


## Worker age benchmark

A workplace-worker age benchmark is built from SCB TAB3205. The table provides three mutually exclusive broad groups suitable for this purpose: 15-24, 25-54 and 55-74, by sex and workplace municipality, averaged over 2022-2024.

For Lulea, about 11.2% of workers are 15-24, while 38.4% of observed municipal in-migration age 0-64 is 18-24. This confirms that total in-migration is too student-heavy to serve as the default job-holder profile. The worker benchmark is therefore used to construct the worker component of the default workplace scenario; the model still keeps alternative profiles for sensitivity analysis. This change is source-driven rather than fitted to a preferred forecast outcome.
