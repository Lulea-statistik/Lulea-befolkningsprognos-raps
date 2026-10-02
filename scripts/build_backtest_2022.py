#!/usr/bin/env python3
"""Build a 2022-2024 out-of-sample backtest package.

Calibration uses only data through 2021. The model is then projected for
2022-2024 and compared with observed SCB outcomes. 2025 is excluded from the
primary backtest because of the CKM method break.
"""
from __future__ import annotations

import json
import statistics
from collections import defaultdict
from pathlib import Path

import build_model_data as b

ROOT = Path(__file__).resolve().parents[1]
OUTDIR = ROOT / "data" / "backtests"
OUTDIR.mkdir(parents=True, exist_ok=True)

BACKTEST_BASE_YEAR = 2021
BACKTEST_END_YEAR = 2024
BACKTEST_WINDOWS = (3, 6, 10)
BACKTEST_MIGRATION_WINDOWS = (2, 3, 4, 6, 10)

def historical_population():
    raw = b.aggregate_fa_age_sex(
        b.load_wide_age_sex("population_pre2025.csv")
    )
    return raw

def base_population(pop, year):
    out = []
    for geo in list(b.MUNICIPALITIES) + [b.FA_CODE]:
        for sex in ("K", "M"):
            for age in range(101):
                out.append({
                    "geo": geo,
                    "year": year,
                    "sex": sex,
                    "age": age,
                    "value": pop.get((geo, year, sex, age), 0.0),
                })
    return out

def annual_actuals(pop, births, deaths, netmig, inflow, outflow):
    result = []
    geos = list(b.MUNICIPALITIES) + [b.FA_CODE]
    for geo in geos:
        for year in range(BACKTEST_BASE_YEAR, BACKTEST_END_YEAR + 1):
            population = sum(
                pop.get((geo, year, sex, age), 0.0)
                for sex in ("K", "M") for age in range(101)
            )
            births_total = 0.0
            deaths_total = 0.0
            netmig_total = 0.0
            inflow_total = None
            outflow_total = None
            if year > BACKTEST_BASE_YEAR:
                births_total = sum(
                    births.get((geo, year, age), 0.0)
                    for age in range(15, 50)
                )
                deaths_total = sum(
                    deaths.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M") for age in range(101)
                )
                netmig_total = sum(
                    netmig.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M") for age in range(101)
                )
                if geo in b.MUNICIPALITIES:
                    inflow_total = sum(
                        inflow.get((geo, year, sex, age), 0.0)
                        for sex in ("K", "M") for age in range(101)
                    )
                    outflow_total = sum(
                        outflow.get((geo, year, sex, age), 0.0)
                        for sex in ("K", "M") for age in range(101)
                    )
            result.append({
                "geo": geo,
                "year": year,
                "population": population,
                "births": births_total,
                "deaths": deaths_total,
                "netMigration": netmig_total,
                "grossInMigration": inflow_total,
                "grossOutMigration": outflow_total,
            })
    return result

def age_actuals(pop):
    result = []
    for geo in list(b.MUNICIPALITIES) + [b.FA_CODE]:
        for year in range(BACKTEST_BASE_YEAR + 1, BACKTEST_END_YEAR + 1):
            for age in range(101):
                women = pop.get((geo, year, "K", age), 0.0)
                men = pop.get((geo, year, "M", age), 0.0)
                result.append({
                    "geo": geo,
                    "year": year,
                    "age": age,
                    "women": women,
                    "men": men,
                    "total": women + men,
                })
    return result

def migration_leg_age_backtest(pre2025):
    """Out-of-sample age/leg migration diagnostic for Lulea.

    For each backtest window, use only detailed migration-leg years available
    through 2021. Compare that historical age-specific mean with observed
    2022-2024 flows. This is diagnostic only and does not alter the forecast.
    """
    geo = "2580"
    available_years = sorted({
        year
        for (g, year, _sex, _age, _leg, _direction), value in pre2025.items()
        if g == geo and year <= BACKTEST_BASE_YEAR and value > 0
    })
    result = []
    for window in BACKTEST_WINDOWS:
        calibration_years = available_years[-window:]
        if not calibration_years:
            continue
        for year in range(BACKTEST_BASE_YEAR + 1, BACKTEST_END_YEAR + 1):
            for age in range(101):
                for leg, label in b.MIGRATION_LEG_LABELS.items():
                    values = {}
                    for direction in ("in", "out", "net"):
                        historical = [
                            sum(
                                pre2025.get(
                                    (geo, y, sex, age, leg, direction), 0.0
                                )
                                for sex in ("K", "M")
                            )
                            for y in calibration_years
                        ]
                        predicted = (
                            statistics.fmean(historical) if historical else 0.0
                        )
                        actual = sum(
                            pre2025.get(
                                (geo, year, sex, age, leg, direction), 0.0
                            )
                            for sex in ("K", "M")
                        )
                        values[direction] = (predicted, actual)

                    pred_in, act_in = values["in"]
                    pred_out, act_out = values["out"]
                    pred_net, act_net = values["net"]
                    result.append({
                        "geo": geo,
                        "window": window,
                        "year": year,
                        "age": age,
                        "cohort": year - age,
                        "leg": leg,
                        "label": label,
                        "calibrationStartYear": calibration_years[0],
                        "calibrationEndYear": calibration_years[-1],
                        "calibrationYears": len(calibration_years),
                        "predictedInflow": pred_in,
                        "actualInflow": act_in,
                        "inflowError": pred_in - act_in,
                        "predictedOutflow": pred_out,
                        "actualOutflow": act_out,
                        "outflowError": pred_out - act_out,
                        "predictedNetMigration": pred_net,
                        "actualNetMigration": act_net,
                        "netMigrationError": pred_net - act_net,
                    })
    return result

def main():
    # Reuse the production calibration logic but change the historical cutoff.
    original_end = b.CALIBRATION_END
    original_windows = b.WINDOWS
    try:
        b.CALIBRATION_END = BACKTEST_BASE_YEAR
        b.WINDOWS = BACKTEST_WINDOWS

        pop = historical_population()
        birth_year_exposure = b.aggregate_fa_age_sex(
            b.load_wide_age_sex(b.HISTORICAL_BIRTH_YEAR_EXPOSURE_FILE)
        )
        fertility_exposure = b.aggregate_fa_age_sex(
            b.load_wide_age_sex(b.HISTORICAL_EVENT_AGE_EXPOSURE_FILE)
        )
        deaths = b.aggregate_fa_age_sex(
            b.load_wide_age_sex("deaths_pre2025.csv")
        )
        births = b.aggregate_fa_births(
            b.load_births("births_pre2025.csv")
        )
        inflow = b.aggregate_fa_age_sex(
            b.load_wide_age_sex("migration_pre2025.csv", b.IN_MIG_CODES)
        )
        outflow = b.aggregate_fa_age_sex(
            b.load_wide_age_sex("migration_pre2025.csv", b.OUT_MIG_CODES)
        )
        netmig = b.aggregate_fa_age_sex(
            b.load_wide_age_sex("migration_pre2025.csv", b.NET_MIG_CODES)
        )
        migration_legs = b.load_migration_legs(
            "migration_birth_region_pre2025.csv",
            b.MIGRATION_LEG_CODES_PRE2025,
        )

        fertility_rates, fertility_factors = b.fertility_profiles(births, fertility_exposure)
        mortality_risks, mortality_factors = b.mortality_profiles(deaths, birth_year_exposure)

        future_fert, future_mort = b.national_future_profiles(
            "backtest_national_detail_2021.csv",
            "backtest_national_detail_2021",
            "backtest_births_2021.csv",
        )
        if future_fert and future_mort:
            fertility_rates, mortality_risks = b.extend_profiles_with_future(
                fertility_rates, mortality_risks,
                future_fert, future_mort,
                start_year=2022,
            )
            vintage_mode = "SCB 2021 national forecast profiles"
        else:
            vintage_mode = "historical profiles held constant (fallback)"

        input_model = {
            "meta": {
                "schemaVersion": "0.1.0-backtest",
                "dataReady": True,
                "baseYear": BACKTEST_BASE_YEAR,
                "backtestEndYear": BACKTEST_END_YEAR,
                "calibrationEndYear": BACKTEST_BASE_YEAR,
                "note": "Out-of-sample backtest: local calibration uses no information after 2021; national future profiles use the SCB 2021 forecast vintage.",
                "nationalForecastVintage": vintage_mode
            },
            "geographies": [
                {"code": b.FA_CODE, "name": "Luleå FA",
                 "members": list(b.MUNICIPALITIES)},
                *[{"code": c, "name": n} for c, n in b.MUNICIPALITIES.items()],
            ],
            "calibration": {
                "defaultYears": 10,
                "options": list(BACKTEST_WINDOWS),
            },
            "parameters": {
                "sexRatioMaleAtBirth": 0.515,
                "sexRatioMaleAtBirthSource": "Raps technical specification",
                "qutbMode": "identity",
                "endogenousInMigration": False,
                "endogenousOutMigration": False,
                "grossFlowCandidate": (
                    "historical gross inflow counts plus population-responsive "
                    "historical urisk; diagnostic only"
                ),
            },
            "populationBase": base_population(pop, BACKTEST_BASE_YEAR),
            "fertilityRates": fertility_rates,
            "mortalityRisks": mortality_risks,
            "netMigration": b.migration_profiles(netmig),
            "outMigrationRisks": b.outmigration_risk_profiles(outflow, birth_year_exposure),
            "grossInMigration": b.gross_inmigration_profiles(inflow),
            "diagnostics": {
                "relativeFactors": {
                    "fertility": fertility_factors,
                    "mortality": mortality_factors,
                }
            }
        }

        observed = {
            "baseYear": BACKTEST_BASE_YEAR,
            "endYear": BACKTEST_END_YEAR,
            "source": "SCB historical population, births, deaths and migration tables",
            "rows": annual_actuals(pop, births, deaths, netmig, inflow, outflow),
            "ageRows": age_actuals(pop),
            "migrationLegAgeBacktestLulea": migration_leg_age_backtest(
                migration_legs
            ),
        }

        (OUTDIR / "model_2022_input.json").write_text(
            json.dumps(input_model, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        (OUTDIR / "actual_2022_2024.json").write_text(
            json.dumps(observed, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print("Wrote backtest model and actual outcomes.")
    finally:
        b.CALIBRATION_END = original_end
        b.WINDOWS = original_windows

if __name__ == "__main__":
    main()
