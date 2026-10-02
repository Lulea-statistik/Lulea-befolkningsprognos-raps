#!/usr/bin/env python3
"""Build locked external municipality holdout inputs for component_flow.

The municipality set and decision rule are frozen in
data/component_flow_holdout_municipalities.json before the corresponding
migration-engine forecast results are generated.

Origins 2018-2021 use only local observations available through each origin and
the matching SCB national forecast vintage. The existing 10-year exogenous
net-migration model is compared with the locked three-leg component_flow engine.
"""
from __future__ import annotations

import json
from pathlib import Path

import build_model_data as b
import build_rolling_backtest as rolling

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "data" / "component_flow_holdout_municipalities.json"
WINDOW_CONFIG = ROOT / "data" / "migration_component_windows.json"
OUTDIR = ROOT / "data" / "backtests"
WORKDIR = OUTDIR / "component_flow_holdout_work"
WORKDIR.mkdir(parents=True, exist_ok=True)
HORIZON_YEARS = 3
WINDOWS = (10,)
MIGRATION_WINDOWS = (2, 4, 6, 10)


def restrict_age_sex(source, geo):
    allowed = {geo, b.RIKET_CODE}
    return {k: v for k, v in source.items() if k[0] in allowed}


def restrict_births(source, geo):
    allowed = {geo, b.RIKET_CODE}
    return {k: v for k, v in source.items() if k[0] in allowed}


def base_population(pop, geo, year):
    return [
        {
            "geo": geo,
            "year": year,
            "sex": sex,
            "age": age,
            "value": pop.get((geo, year, sex, age), 0.0),
        }
        for sex in ("K", "M")
        for age in range(101)
    ]


def actual_rows(pop, births, deaths, inflow, outflow, netmig, geo, origin, end_year):
    rows = []
    for year in range(origin + 1, end_year + 1):
        rows.append({
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
    return rows


def build_geo_origin(geo, name, origin, origin_cfg, raw, window_cfg):
    original_municipalities = b.MUNICIPALITIES
    original_fa_code = b.FA_CODE
    original_end = b.CALIBRATION_END
    original_windows = b.WINDOWS
    original_migration_windows = b.MIGRATION_WINDOWS
    end_year = origin + HORIZON_YEARS

    try:
        b.MUNICIPALITIES = {geo: name}
        b.FA_CODE = f"HOLDOUT_{geo}"
        b.CALIBRATION_END = origin
        b.WINDOWS = WINDOWS
        b.MIGRATION_WINDOWS = MIGRATION_WINDOWS

        pop = restrict_age_sex(raw["population"], geo)
        birth_year_exposure = restrict_age_sex(raw["birth_year_exposure"], geo)
        event_age_exposure = restrict_age_sex(raw["event_age_exposure"], geo)
        deaths = restrict_age_sex(raw["deaths"], geo)
        births = restrict_births(raw["births"], geo)
        inflow = restrict_age_sex(raw["inflow"], geo)
        outflow = restrict_age_sex(raw["outflow"], geo)
        netmig = restrict_age_sex(raw["netmig"], geo)
        legs = {
            k: v for k, v in raw["migration_legs"].items()
            if k[0] == geo
        }

        if not any(k[0] == geo for k in pop):
            raise RuntimeError(f"Missing historical population for holdout municipality {geo}.")
        if not legs:
            raise RuntimeError(f"Missing migration-leg history for holdout municipality {geo}.")

        fertility_rates, fertility_factors = b.fertility_profiles(
            births, event_age_exposure
        )
        mortality_risks, mortality_factors = b.mortality_profiles(
            deaths, birth_year_exposure
        )
        component_inflow, component_out_hazards = b.migration_component_profiles(
            legs, birth_year_exposure
        )

        detail_key = origin_cfg["detail_key"]
        births_key = origin_cfg["births_key"]
        future_fert, future_mort = b.national_future_profiles(
            f"{detail_key}.csv",
            detail_key,
            f"{births_key}.csv",
        )
        if not future_fert or not future_mort:
            raise RuntimeError(
                f"Missing national forecast vintage for holdout origin {origin}."
            )

        fertility_rates, mortality_risks = b.extend_profiles_with_future(
            fertility_rates,
            mortality_risks,
            future_fert,
            future_mort,
            start_year=origin + 1,
        )

        model = {
            "meta": {
                "schemaVersion": "0.1.0-component-flow-holdout",
                "dataReady": True,
                "baseYear": origin,
                "backtestEndYear": end_year,
                "calibrationEndYear": origin,
                "nationalForecastVintage": origin,
                "holdoutMunicipality": geo,
                "note": (
                    "Locked external municipality holdout. No local information "
                    "after the forecast origin is used for calibration."
                ),
            },
            "geographies": [{"code": geo, "name": name}],
            "calibration": {"defaultYears": 10, "options": [10]},
            "parameters": {
                "sexRatioMaleAtBirth": 0.515,
                "qutbMode": "identity",
                "endogenousInMigration": False,
                "endogenousOutMigration": False,
                "defaultMigrationWindow": 10,
                "migrationComponentStatus": "locked_external_holdout_candidate",
                "migrationComponentProductionDefault": False,
                "migrationComponentWindows": window_cfg["legs"],
            },
            "populationBase": base_population(pop, geo, origin),
            "fertilityRates": fertility_rates,
            "mortalityRisks": mortality_risks,
            "netMigration": b.migration_profiles(netmig),
            "migrationComponentInflow": component_inflow,
            "migrationComponentOutHazards": component_out_hazards,
            "diagnostics": {
                "relativeFactors": {
                    "fertility": fertility_factors,
                    "mortality": mortality_factors,
                }
            },
        }
        actual = {
            "geo": geo,
            "name": name,
            "origin": origin,
            "endYear": end_year,
            "rows": actual_rows(
                pop, births, deaths, inflow, outflow, netmig,
                geo, origin, end_year
            ),
        }

        stem = f"{geo}_{origin}"
        model_path = WORKDIR / f"model_{stem}.json"
        actual_path = WORKDIR / f"actual_{stem}.json"
        model_path.write_text(
            json.dumps(model, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        actual_path.write_text(
            json.dumps(actual, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return {
            "geo": geo,
            "name": name,
            "origin": origin,
            "endYear": end_year,
            "modelFile": model_path.name,
            "actualFile": actual_path.name,
        }
    finally:
        b.MUNICIPALITIES = original_municipalities
        b.FA_CODE = original_fa_code
        b.CALIBRATION_END = original_end
        b.WINDOWS = original_windows
        b.MIGRATION_WINDOWS = original_migration_windows


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if cfg.get("status") != "locked_before_component_flow_holdout_results":
        raise RuntimeError("Component-flow holdouts must be locked before results are generated.")
    window_cfg = json.loads(WINDOW_CONFIG.read_text(encoding="utf-8"))

    holdouts = cfg.get("municipalities") or {}
    allowed = set(holdouts) | {b.RIKET_CODE}
    raw = {
        "population": b.load_wide_age_sex(
            "population_pre2025.csv", allowed_geos=allowed
        ),
        "birth_year_exposure": b.load_wide_age_sex(
            b.HISTORICAL_BIRTH_YEAR_EXPOSURE_FILE, allowed_geos=allowed
        ),
        "event_age_exposure": b.load_wide_age_sex(
            b.HISTORICAL_EVENT_AGE_EXPOSURE_FILE, allowed_geos=allowed
        ),
        "deaths": b.load_wide_age_sex(
            "deaths_pre2025.csv", allowed_geos=allowed
        ),
        "births": b.load_births(
            "births_pre2025.csv", allowed_geos=allowed
        ),
        "inflow": b.load_wide_age_sex(
            "migration_pre2025.csv", b.IN_MIG_CODES, allowed_geos=allowed
        ),
        "outflow": b.load_wide_age_sex(
            "migration_pre2025.csv", b.OUT_MIG_CODES, allowed_geos=allowed
        ),
        "netmig": b.load_wide_age_sex(
            "migration_pre2025.csv", b.NET_MIG_CODES, allowed_geos=allowed
        ),
        "migration_legs": b.load_migration_legs(
            "migration_birth_region_pre2025.csv",
            b.MIGRATION_LEG_CODES_PRE2025,
            allowed_geos=set(holdouts),
        ),
    }

    entries = []
    for geo, spec in holdouts.items():
        for origin, origin_cfg in rolling.ORIGINS.items():
            entries.append(
                build_geo_origin(
                    geo, spec["name"], origin, origin_cfg, raw, window_cfg
                )
            )

    manifest = {
        "schemaVersion": "0.1.0",
        "method": (
            "Locked external municipality validation of component_flow versus "
            "the 10-year exogenous net-migration baseline inside the full "
            "event-age aligned cohort model."
        ),
        "holdoutConfig": str(CONFIG.relative_to(ROOT)),
        "componentWindowConfig": str(WINDOW_CONFIG.relative_to(ROOT)),
        "candidateLockedBeforeResults": True,
        "productionDefaultChanged": False,
        "decisionRule": cfg["productionDecisionRule"],
        "municipalities": holdouts,
        "origins": sorted(rolling.ORIGINS),
        "horizonYears": HORIZON_YEARS,
        "entries": entries,
    }
    (WORKDIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "Built locked component-flow holdout inputs for: " +
        ", ".join(f"{geo} {spec['name']}" for geo, spec in holdouts.items())
    )


if __name__ == "__main__":
    main()
