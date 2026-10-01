#!/usr/bin/env python3
"""Build vintage-correct rolling-origin demographic backtest inputs.

Origins 2018, 2019, 2020 and 2021 use local observations only through the
origin year and the SCB national forecast vintage published in that same year.
Each origin is evaluated for the following three calendar years.

Intermediate model/actual files are written under data/backtests/rolling_work
and are intentionally git-ignored. The scored report is produced separately by
scripts/run_rolling_backtest.js.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import build_model_data as b

ROOT = Path(__file__).resolve().parents[1]
OUTDIR = ROOT / "data" / "backtests"
WORKDIR = OUTDIR / "rolling_work"
WORKDIR.mkdir(parents=True, exist_ok=True)

WINDOWS = (6, 10)
HORIZON_YEARS = 3
ORIGINS = {
    2018: {
        "detail_key": "backtest_national_detail_2018",
        "births_key": "backtest_births_2018",
    },
    2019: {
        "detail_key": "backtest_national_detail_2019",
        "births_key": "backtest_births_2019",
    },
    2020: {
        "detail_key": "backtest_national_detail_2020",
        "births_key": "backtest_births_2020",
    },
    2021: {
        "detail_key": "backtest_national_detail_2021",
        "births_key": "backtest_births_2021",
    },
}


def historical_population():
    return b.aggregate_fa_age_sex(
        b.load_wide_age_sex("population_pre2025.csv")
    )


def base_population(pop, year):
    result = []
    for geo in list(b.MUNICIPALITIES) + [b.FA_CODE]:
        for sex in ("K", "M"):
            for age in range(101):
                result.append({
                    "geo": geo,
                    "year": year,
                    "sex": sex,
                    "age": age,
                    "value": pop.get((geo, year, sex, age), 0.0),
                })
    return result


def annual_actuals(pop, births, deaths, netmig, origin, end_year):
    result = []
    for geo in list(b.MUNICIPALITIES) + [b.FA_CODE]:
        for year in range(origin + 1, end_year + 1):
            result.append({
                "geo": geo,
                "year": year,
                "horizon": year - origin,
                "population": sum(
                    pop.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M") for age in range(101)
                ),
                "births": sum(
                    births.get((geo, year, age), 0.0)
                    for age in range(15, 50)
                ),
                "deaths": sum(
                    deaths.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M") for age in range(101)
                ),
                "netMigration": sum(
                    netmig.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M") for age in range(101)
                ),
            })
    return result


def national_assumption_rows_from_counts(
    origin,
    end_year,
    forecast_births,
    forecast_deaths,
    actual_births,
    actual_deaths,
):
    """Compare the SCB national forecast vintage with realized Sweden totals.

    This diagnostic separates errors already present in the national forecast
    vintage from errors introduced when the national age profiles are localized
    to the municipalities.
    """
    result = []
    for year in range(origin + 1, end_year + 1):
        predicted_births = sum(
            forecast_births.get((year, age), 0.0)
            for age in range(15, 50)
        )
        observed_births = sum(
            actual_births.get((b.RIKET_CODE, year, age), 0.0)
            for age in range(15, 50)
        )
        predicted_deaths = sum(
            forecast_deaths.get((year, sex, age), 0.0)
            for sex in ("K", "M") for age in range(101)
        )
        observed_deaths = sum(
            actual_deaths.get((b.RIKET_CODE, year, sex, age), 0.0)
            for sex in ("K", "M") for age in range(101)
        )
        result.append({
            "year": year,
            "horizon": year - origin,
            "predictedBirths": predicted_births,
            "actualBirths": observed_births,
            "birthsError": predicted_births - observed_births,
            "predictedDeaths": predicted_deaths,
            "actualDeaths": observed_deaths,
            "deathsError": predicted_deaths - observed_deaths,
        })
    return result


def national_only_mortality_rows(future_mort, start_year, end_year):
    """Build a no-localization mortality alternative for diagnostics only.

    Every municipality receives the same SCB national age/sex hazard for each
    forecast year. The rows are duplicated across calibration windows so the
    ordinary model engine can be reused without changing production behavior.
    """
    result = []
    for geo in b.MUNICIPALITIES:
        for window in WINDOWS:
            for (year, sex, age), hazard in future_mort.items():
                if year < start_year or year > end_year:
                    continue
                risk = 1.0 - math.exp(-max(0.0, float(hazard or 0.0)))
                result.append({
                    "geo": geo,
                    "window": window,
                    "year": year,
                    "sex": sex,
                    "age": age,
                    "value": max(0.0, min(1.0, risk)),
                    "source": "SCB national forecast mortality; no local multiplier",
                })
    return result


def build_origin(origin, cfg, pop, exposure, deaths, births, netmig):
    original_end = b.CALIBRATION_END
    original_windows = b.WINDOWS
    end_year = origin + HORIZON_YEARS
    try:
        b.CALIBRATION_END = origin
        b.WINDOWS = WINDOWS

        fertility_rates, fertility_factors = b.fertility_profiles(
            births, exposure
        )
        mortality_risks, mortality_factors = b.mortality_profiles(
            deaths, exposure
        )

        detail_key = cfg["detail_key"]
        births_key = cfg["births_key"]
        detail_file = f"{detail_key}.csv"
        births_file = f"{births_key}.csv"
        forecast_birth_counts = b.load_forecast_birth_counts(births_file)
        forecast_deaths, _ = b.load_forecast_detail(detail_file, detail_key)
        future_fert, future_mort = b.national_future_profiles(
            detail_file,
            detail_key,
            births_file,
        )
        if not future_fert or not future_mort:
            raise RuntimeError(
                f"Missing usable SCB forecast profiles for origin {origin}"
            )

        fertility_rates, mortality_risks = b.extend_profiles_with_future(
            fertility_rates,
            mortality_risks,
            future_fert,
            future_mort,
            start_year=origin + 1,
        )

        mortality_risks_national_only = national_only_mortality_rows(
            future_mort,
            start_year=origin + 1,
            end_year=end_year,
        )

        model = {
            "meta": {
                "schemaVersion": "0.1.0-rolling-backtest",
                "dataReady": True,
                "baseYear": origin,
                "backtestEndYear": end_year,
                "calibrationEndYear": origin,
                "nationalForecastVintage": origin,
                "note": (
                    "Rolling-origin validation: local calibration uses no "
                    f"information after {origin}; future national fertility "
                    f"and mortality use the SCB {origin} forecast vintage."
                ),
            },
            "geographies": [
                {
                    "code": b.FA_CODE,
                    "name": "Luleå FA",
                    "members": list(b.MUNICIPALITIES),
                },
                *[
                    {"code": code, "name": name}
                    for code, name in b.MUNICIPALITIES.items()
                ],
            ],
            "calibration": {
                "defaultYears": 10,
                "options": list(WINDOWS),
            },
            "parameters": {
                "sexRatioMaleAtBirth": 0.515,
                "sexRatioMaleAtBirthSource": "Raps technical specification",
                "qutbMode": "identity",
                "endogenousInMigration": False,
                "endogenousOutMigration": False,
            },
            "populationBase": base_population(pop, origin),
            "fertilityRates": fertility_rates,
            "mortalityRisks": mortality_risks,
            "mortalityRisksNationalOnly": mortality_risks_national_only,
            "netMigration": b.migration_profiles(netmig),
            "diagnostics": {
                "relativeFactors": {
                    "fertility": fertility_factors,
                    "mortality": mortality_factors,
                }
            },
        }
        actual = {
            "origin": origin,
            "endYear": end_year,
            "rows": annual_actuals(
                pop, births, deaths, netmig, origin, end_year
            ),
            "nationalAssumptionRows": national_assumption_rows_from_counts(
                origin,
                end_year,
                forecast_birth_counts,
                forecast_deaths,
                births,
                deaths,
            ),
        }

        model_path = WORKDIR / f"model_{origin}.json"
        actual_path = WORKDIR / f"actual_{origin}.json"
        model_path.write_text(
            json.dumps(model, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        actual_path.write_text(
            json.dumps(actual, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        return {
            "origin": origin,
            "endYear": end_year,
            "detailKey": detail_key,
            "birthsKey": births_key,
            "modelFile": model_path.name,
            "actualFile": actual_path.name,
        }
    finally:
        b.CALIBRATION_END = original_end
        b.WINDOWS = original_windows


def main():
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

    entries = [
        build_origin(
            origin, cfg, pop, exposure, deaths, births, netmig
        )
        for origin, cfg in ORIGINS.items()
    ]

    manifest = {
        "schemaVersion": "0.1.0",
        "method": (
            "Vintage-correct rolling-origin validation with three-year "
            "forecast horizons."
        ),
        "origins": entries,
        "windows": list(WINDOWS),
        "horizonYears": HORIZON_YEARS,
        "overlapNote": (
            "Forecast windows overlap in calendar time and must not be treated "
            "as statistically independent experiments."
        ),
    }
    (WORKDIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "Built rolling-origin inputs for: "
        + ", ".join(str(x["origin"]) for x in entries)
    )


if __name__ == "__main__":
    main()
