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

WINDOWS = (3, 6, 10)
MIGRATION_WINDOWS = (2, 3, 4, 6, 10)
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


def annual_actuals(pop, births, deaths, inflow, outflow, netmig, origin, end_year):
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
                "grossInMigration": sum(
                    inflow.get((geo, year, sex, age), 0.0)
                    for sex in ("K", "M") for age in range(101)
                ),
                "grossOutMigration": sum(
                    outflow.get((geo, year, sex, age), 0.0)
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


def national_only_fertility_rows(future_fert, start_year, end_year):
    """Build a no-localization fertility alternative for diagnostics only.

    Every forecast geography receives the same SCB national age-specific
    fertility rate for each forecast year. Rows are duplicated across the
    3/6/10 calibration windows so the ordinary model engine can be reused.
    """
    result = []
    geos = [*b.MUNICIPALITIES, b.FA_CODE]
    for geo in geos:
        for window in WINDOWS:
            for (year, age), rate in future_fert.items():
                if year < start_year or year > end_year:
                    continue
                result.append({
                    "geo": geo,
                    "window": window,
                    "year": year,
                    "age": age,
                    "value": max(0.0, float(rate or 0.0)),
                    "source": "SCB national forecast fertility; no local multiplier",
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


def build_origin(
    origin, cfg, pop, birth_year_exposure, fertility_exposure, deaths, births,
    inflow, outflow, netmig, migration_legs, population_birth_status,
    migration_birth_status, component_cfg, scb_risk_cfg, recency_cfg,
    profet_birth_cfg
):
    original_end = b.CALIBRATION_END
    original_windows = b.WINDOWS
    original_migration_windows = b.MIGRATION_WINDOWS
    end_year = origin + HORIZON_YEARS
    try:
        b.CALIBRATION_END = origin
        b.WINDOWS = WINDOWS
        b.MIGRATION_WINDOWS = MIGRATION_WINDOWS

        fertility_rates, fertility_factors = b.fertility_profiles(
            births, fertility_exposure
        )
        mortality_risks, mortality_factors = b.mortality_profiles(
            deaths, birth_year_exposure
        )
        component_inflow, component_out_hazards = b.migration_component_profiles(
            migration_legs, birth_year_exposure
        )
        recency_out_hazards = b.migration_recency_out_hazards(
            migration_legs, birth_year_exposure, recency_cfg
        )
        (
            scb_risk_internal_in_levels,
            scb_risk_internal_in_distribution,
            scb_risk_out,
            scb_risk_international_in,
        ) = b.scb_risk_migration_profiles(
            migration_legs, birth_year_exposure, scb_risk_cfg
        )
        (
            profet_birth_in_levels,
            profet_birth_in_distribution,
            profet_birth_out,
            profet_birth_international_in,
        ) = b.profet_birth_status_profiles(
            migration_birth_status,
            population_birth_status,
            profet_birth_cfg,
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
        (
            scb_national_immigration,
            scb_national_migration_exposure,
        ) = b.load_forecast_migration_context(
            detail_file,
            detail_key,
        )
        (
            profet_birth_national_immigration,
            profet_birth_national_exposure,
        ) = b.load_forecast_migration_context_by_birth_status(
            detail_file,
            detail_key,
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

        fertility_rates_national_only = national_only_fertility_rows(
            future_fert,
            start_year=origin + 1,
            end_year=end_year,
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
                "migrationComponentStatus": "development_candidate_not_production_default",
                "migrationComponentProductionDefault": False,
                "migrationComponentWindows": component_cfg["legs"],
                "migrationRecencyCandidateStatus": "development_candidate_not_production_default",
                "migrationRecencyCandidate": recency_cfg,
                "scbRiskMigrationStatus": "development_candidate_not_production_default",
                "scbRiskMigrationProductionDefault": False,
                "scbRiskMigrationConfig": scb_risk_cfg,
                "profetBirthStatusStatus": "development_candidate_not_production_default",
                "profetBirthStatusProductionDefault": False,
                "profetBirthStatusConfig": profet_birth_cfg,
            },
            "populationBase": base_population(pop, origin),
            "populationBaseBirthStatus": b.birth_status_population_rows(
                population_birth_status, origin
            ),
            "fertilityRates": fertility_rates,
            "fertilityRatesNationalOnly": fertility_rates_national_only,
            "mortalityRisks": mortality_risks,
            "mortalityRisksNationalOnly": mortality_risks_national_only,
            "netMigration": b.migration_profiles(netmig),
            "migrationComponentInflow": component_inflow,
            "migrationComponentOutHazards": component_out_hazards,
            "migrationRecencyOutHazards": recency_out_hazards,
            "scbRiskDomesticInLevels": scb_risk_internal_in_levels,
            "scbRiskDomesticInDistribution": scb_risk_internal_in_distribution,
            "scbRiskOutMigration": scb_risk_out,
            "scbRiskInternationalInMigration": scb_risk_international_in,
            "profetBirthStatusDomesticInLevels": profet_birth_in_levels,
            "profetBirthStatusDomesticInDistribution": profet_birth_in_distribution,
            "profetBirthStatusOutMigration": profet_birth_out,
            "profetBirthStatusInternationalInMigration": profet_birth_international_in,
            "profetBirthStatusNationalMeanPopulation": [
                {
                    "year": year,
                    "status": status,
                    "sex": sex,
                    "age": age,
                    "value": value,
                }
                for (year, status, sex, age), value in sorted(
                    profet_birth_national_exposure.items()
                )
                if origin < year <= end_year
            ],
            "profetBirthStatusNationalImmigration": [
                {"year": year, "status": status, "value": value}
                for (year, status), value in sorted(
                    profet_birth_national_immigration.items()
                )
                if origin < year <= end_year
            ],
            "scbRiskNationalMeanPopulation": [
                {"year": year, "sex": sex, "age": age, "value": value}
                for (year, sex, age), value in sorted(
                    scb_national_migration_exposure.items()
                )
                if origin < year <= end_year
            ],
            "scbRiskNationalImmigration": [
                {"year": year, "value": value}
                for year, value in sorted(scb_national_immigration.items())
                if origin < year <= end_year
            ],
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
                pop, births, deaths, inflow, outflow, netmig, origin, end_year
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
        b.MIGRATION_WINDOWS = original_migration_windows


def main():
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
        allowed_geos=set(b.MUNICIPALITIES) | {b.RIKET_CODE},
    )
    population_birth_status = b.load_population_birth_status(
        "population_birth_region_pre2025.csv",
        "population_birth_region_pre2025",
        allowed_geos=set(b.MUNICIPALITIES) | {b.RIKET_CODE},
    )
    migration_birth_status = b.load_migration_legs_birth_status(
        "migration_birth_region_pre2025.csv",
        "migration_birth_region_pre2025",
        b.MIGRATION_LEG_CODES_PRE2025,
        allowed_geos=set(b.MUNICIPALITIES) | {b.RIKET_CODE},
    )
    component_cfg = json.loads(
        (ROOT / "data" / "migration_component_windows.json").read_text(encoding="utf-8")
    )
    scb_risk_cfg = json.loads(
        (ROOT / "data" / "scb_risk_migration_config.json").read_text(encoding="utf-8")
    )
    recency_cfg = json.loads(
        (ROOT / "data" / "migration_recency_candidate.json").read_text(encoding="utf-8")
    )
    if recency_cfg.get("status") != "development_candidate_locked_before_full_cohort_results":
        raise RuntimeError("Unexpected migration recency candidate status.")
    profet_birth_cfg = json.loads(
        (ROOT / "data" / "profet_birth_status_config.json").read_text(encoding="utf-8")
    )
    if profet_birth_cfg.get("status") != "development_candidate_locked_before_birth_status_results":
        raise RuntimeError("Unexpected Profet birth-status candidate status.")

    entries = [
        build_origin(
            origin, cfg, pop, birth_year_exposure, fertility_exposure,
            deaths, births, inflow, outflow, netmig, migration_legs,
            population_birth_status, migration_birth_status,
            component_cfg, scb_risk_cfg, recency_cfg, profet_birth_cfg
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
        "migrationWindows": list(MIGRATION_WINDOWS),
        "componentFlowCandidate": {
            "config": "data/migration_component_windows.json",
            "selectionSample": "Lulea municipality component results used to choose windows after #37",
            "independentHoldout": False,
            "note": "This rolling comparison is a development diagnostic, not independent confirmation."
        },
        "migrationRecencyCandidate": {
            "config": "data/migration_recency_candidate.json",
            "baseEngine": "component_flow",
            "adaptiveLeg": "rest_sweden",
            "adaptiveDirection": "out",
            "independentHoldout": False,
            "note": "Selected from Lulea migration diagnostics after #53; full cohort rolling-origin is stage 1."
        },
        "scbRiskFlowCandidate": {
            "config": "data/scb_risk_migration_config.json",
            "methodBasis": "Published SCB regional projection method; locked before this candidate is evaluated.",
            "independentHoldout": False,
            "note": "Lulea rolling-origin results are development diagnostics. Previously viewed municipalities are not independent confirmation."
        },
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
