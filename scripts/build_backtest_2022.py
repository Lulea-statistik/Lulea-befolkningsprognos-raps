#!/usr/bin/env python3
"""Build a 2022-2024 out-of-sample backtest package.

Calibration uses only data through 2021. The model is then projected for
2022-2024 and compared with observed SCB outcomes. 2025 is excluded from the
primary backtest because of the CKM method break.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import build_model_data as b

ROOT = Path(__file__).resolve().parents[1]
OUTDIR = ROOT / "data" / "backtests"
OUTDIR.mkdir(parents=True, exist_ok=True)

BACKTEST_BASE_YEAR = 2021
BACKTEST_END_YEAR = 2024
BACKTEST_WINDOWS = (6, 10)

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

def annual_actuals(pop, births, deaths, netmig):
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
            result.append({
                "geo": geo,
                "year": year,
                "population": population,
                "births": births_total,
                "deaths": deaths_total,
                "netMigration": netmig_total,
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
        exposure = b.aggregate_fa_age_sex(
            b.load_wide_age_sex("mean_population_pre2025.csv")
        )
        deaths = b.aggregate_fa_age_sex(
            b.load_wide_age_sex("deaths_pre2025.csv")
        )
        births = b.aggregate_fa_births(
            b.load_births("births_pre2025.csv")
        )
        netmig = b.aggregate_fa_age_sex(
            b.load_wide_age_sex("migration_pre2025.csv", b.NET_MIG_CODES)
        )

        fertility_rates, fertility_factors = b.fertility_profiles(births, exposure)
        mortality_risks, mortality_factors = b.mortality_profiles(deaths, exposure)

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
            },
            "populationBase": base_population(pop, BACKTEST_BASE_YEAR),
            "fertilityRates": fertility_rates,
            "mortalityRisks": mortality_risks,
            "netMigration": b.migration_profiles(netmig),
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
            "rows": annual_actuals(pop, births, deaths, netmig),
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
