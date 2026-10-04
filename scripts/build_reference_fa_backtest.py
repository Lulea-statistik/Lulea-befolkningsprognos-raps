#!/usr/bin/env python3
"""Build external FA15 rolling-origin validation inputs.

The reference regions are deliberately fixed to the FA15 definitions supplied
in data/reference_fa_regions.json. They are used as out-of-region robustness
checks for the Lulea model method and are not production forecast geographies.

Origins and national forecast vintages are identical to the main rolling test:
2018, 2019, 2020 and 2021, each evaluated three years ahead.
"""
from __future__ import annotations

import json
from pathlib import Path

import build_model_data as b
import build_rolling_backtest as rolling

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "data" / "reference_fa_regions.json"
OUTDIR = ROOT / "data" / "backtests"
WORKDIR = OUTDIR / "reference_fa_work"
WORKDIR.mkdir(parents=True, exist_ok=True)

WINDOWS = (3, 6, 10)
MIGRATION_WINDOWS = (2, 3, 4, 6, 10)
HORIZON_YEARS = 3


def load_config():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    if cfg.get("scheme") != "FA15":
        raise RuntimeError("Reference validation must use the fixed FA15 scheme.")
    return cfg


def all_member_codes(cfg):
    codes = set()
    for region in (cfg.get("regions") or {}).values():
        codes.update((region.get("members") or {}).keys())
    return sorted(codes)


def restrict_age_sex(source, geos):
    allowed = set(geos) | {b.RIKET_CODE}
    return {
        key: value
        for key, value in source.items()
        if key[0] in allowed
    }


def restrict_births(source, geos):
    allowed = set(geos) | {b.RIKET_CODE}
    return {
        key: value
        for key, value in source.items()
        if key[0] in allowed
    }


def aggregate_group_birth_status_population(source, group_code, members):
    out = dict(source)
    member_set = set(members)
    keys = {
        (year, sex, age, status)
        for (geo, year, sex, age, status) in source
        if geo in member_set
    }
    for year, sex, age, status in keys:
        out[(group_code, year, sex, age, status)] = sum(
            source.get((geo, year, sex, age, status), 0.0)
            for geo in member_set
        )
    return out


def aggregate_group_birth_status_migration(source, group_code, members):
    out = dict(source)
    member_set = set(members)
    keys = {
        (year, sex, age, status, leg, direction)
        for (geo, year, sex, age, status, leg, direction) in source
        if geo in member_set
    }
    for year, sex, age, status, leg, direction in keys:
        out[(group_code, year, sex, age, status, leg, direction)] = sum(
            source.get(
                (geo, year, sex, age, status, leg, direction), 0.0
            )
            for geo in member_set
        )
    return out


def birth_status_actual_rows(
    population_status, members, group_code, origin, end_year
):
    result = []
    for geo in list(members) + [group_code]:
        for year in range(origin + 1, end_year + 1):
            for status in ("sweden_born", "foreign_born"):
                result.append({
                    "geo": geo,
                    "year": year,
                    "status": status,
                    "value": sum(
                        population_status.get(
                            (geo, year, sex, age, status), 0.0
                        )
                        for sex in ("K", "M")
                        for age in range(101)
                    ),
                })
    return result


def base_population(pop, members, group_code, year):
    result = []
    for geo in list(members) + [group_code]:
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


def annual_actuals(pop, births, deaths, netmig, members, group_code, origin, end_year):
    result = []
    for geo in list(members) + [group_code]:
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


def build_region_origin(region_code, region, origin, origin_cfg, raw):
    members = dict(region["members"])
    end_year = origin + HORIZON_YEARS

    original_municipalities = b.MUNICIPALITIES
    original_fa_code = b.FA_CODE
    original_end = b.CALIBRATION_END
    original_windows = b.WINDOWS
    original_migration_windows = b.MIGRATION_WINDOWS

    try:
        b.MUNICIPALITIES = members
        b.FA_CODE = region_code
        b.CALIBRATION_END = origin
        b.WINDOWS = WINDOWS
        b.MIGRATION_WINDOWS = MIGRATION_WINDOWS

        pop = b.aggregate_group_age_sex(
            restrict_age_sex(raw["population"], members),
            region_code,
            members,
        )
        birth_year_exposure = b.aggregate_group_age_sex(
            restrict_age_sex(raw["birth_year_exposure"], members),
            region_code,
            members,
        )
        event_age_exposure = b.aggregate_group_age_sex(
            restrict_age_sex(raw["event_age_exposure"], members),
            region_code,
            members,
        )
        deaths = b.aggregate_group_age_sex(
            restrict_age_sex(raw["deaths"], members),
            region_code,
            members,
        )
        births = b.aggregate_group_births(
            restrict_births(raw["births"], members),
            region_code,
            members,
        )
        netmig = b.aggregate_group_age_sex(
            restrict_age_sex(raw["netmig"], members),
            region_code,
            members,
        )
        population_status = aggregate_group_birth_status_population(
            {
                key: value
                for key, value in raw["population_birth_status"].items()
                if key[0] in set(members)
            },
            region_code,
            members,
        )
        migration_status = aggregate_group_birth_status_migration(
            {
                key: value
                for key, value in raw["migration_birth_status"].items()
                if key[0] in set(members)
            },
            region_code,
            members,
        )
        birth_status_net10_allocation = (
            b.constrained_birth_status_net_allocation(
                migration_status,
                population_status,
                geos=list(members) + [region_code],
                window=10,
            )
        )

        fertility_rates, fertility_factors = b.fertility_profiles(
            births, event_age_exposure
        )
        mortality_risks, mortality_factors = b.mortality_profiles(
            deaths, birth_year_exposure
        )

        detail_key = origin_cfg["detail_key"]
        births_key = origin_cfg["births_key"]
        detail_file = f"{detail_key}.csv"
        births_file = f"{births_key}.csv"
        future_fert, future_mort = b.national_future_profiles(
            detail_file,
            detail_key,
            births_file,
        )
        if not future_fert or not future_mort:
            raise RuntimeError(
                f"Missing SCB national forecast vintage for origin {origin}"
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
                "schemaVersion": "0.1.0-reference-fa",
                "dataReady": True,
                "baseYear": origin,
                "backtestEndYear": end_year,
                "calibrationEndYear": origin,
                "nationalForecastVintage": origin,
                "referenceScheme": "FA15",
                "referenceRegion": region_code,
                "note": (
                    "External robustness test. Same demographic method and "
                    "SCB vintage rules as the Lulea rolling-origin validation."
                ),
            },
            "geographies": [
                {
                    "code": region_code,
                    "name": region["name"],
                    "members": list(members),
                },
                *[
                    {"code": code, "name": name}
                    for code, name in members.items()
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
            "populationBase": base_population(
                pop, members, region_code, origin
            ),
            "populationBaseBirthStatus": b.birth_status_population_rows(
                population_status,
                origin,
                geos=list(members) + [region_code],
            ),
            "birthStatusNet10Allocation": birth_status_net10_allocation,
            "fertilityRates": fertility_rates,
            "mortalityRisks": mortality_risks,
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
            "regionCode": region_code,
            "rows": annual_actuals(
                pop, births, deaths, netmig,
                members, region_code, origin, end_year
            ),
            "populationBirthStatusRows": birth_status_actual_rows(
                population_status,
                members,
                region_code,
                origin,
                end_year,
            ),
        }

        stem = f"{region_code.lower()}_{origin}"
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
            "origin": origin,
            "endYear": end_year,
            "detailKey": detail_key,
            "birthsKey": births_key,
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
    cfg = load_config()
    allowed_geos = set(all_member_codes(cfg)) | {b.RIKET_CODE}

    raw = {
        "population": b.load_wide_age_sex(
            "population_pre2025.csv",
            allowed_geos=allowed_geos,
        ),
        "birth_year_exposure": b.load_wide_age_sex(
            b.HISTORICAL_BIRTH_YEAR_EXPOSURE_FILE,
            allowed_geos=allowed_geos,
        ),
        "event_age_exposure": b.load_wide_age_sex(
            b.HISTORICAL_EVENT_AGE_EXPOSURE_FILE,
            allowed_geos=allowed_geos,
        ),
        "deaths": b.load_wide_age_sex(
            "deaths_pre2025.csv",
            allowed_geos=allowed_geos,
        ),
        "births": b.load_births(
            "births_pre2025.csv",
            allowed_geos=allowed_geos,
        ),
        "netmig": b.load_wide_age_sex(
            "migration_pre2025.csv",
            b.NET_MIG_CODES,
            allowed_geos=allowed_geos,
        ),
        "population_birth_status": b.load_population_birth_status(
            "population_birth_region_pre2025.csv",
            "population_birth_region_pre2025",
            allowed_geos=allowed_geos,
        ),
        "migration_birth_status": b.load_migration_legs_birth_status(
            "migration_birth_region_pre2025.csv",
            "migration_birth_region_pre2025",
            b.MIGRATION_LEG_CODES_PRE2025,
            allowed_geos=allowed_geos,
        ),
    }

    region_entries = []
    for region_code, region in cfg["regions"].items():
        origins = [
            build_region_origin(
                region_code,
                region,
                origin,
                origin_cfg,
                raw,
            )
            for origin, origin_cfg in rolling.ORIGINS.items()
        ]
        region_entries.append({
            "code": region_code,
            "fa15Number": region["fa15Number"],
            "name": region["name"],
            "rationale": region["rationale"],
            "members": region["members"],
            "origins": origins,
        })

    manifest = {
        "schemaVersion": "0.1.0",
        "scheme": cfg["scheme"],
        "source": cfg["source"],
        "method": (
            "External FA15 robustness validation using the same fixed "
            "2018-2021 rolling origins, SCB national forecast vintages, "
            "calibration windows and demographic equations as Lulea."
        ),
        "windows": list(WINDOWS),
        "migrationWindows": list(MIGRATION_WINDOWS),
        "birthStatusNet10Candidate": {
            "config": "data/birth_status_net10_candidate.json",
            "externalLevel3Gate": json.loads(
                (ROOT / "data" / "birth_status_net10_candidate.json")
                .read_text(encoding="utf-8")
            )["externalLevel3Gate"],
        },
        "horizonYears": HORIZON_YEARS,
        "regions": region_entries,
        "governance": (
            "Reference regions and memberships were fixed before viewing "
            "their validation results. No region-specific parameter tuning."
        ),
    }
    (WORKDIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "Built external FA reference inputs for: " +
        ", ".join(x["name"] for x in region_entries)
    )


if __name__ == "__main__":
    main()
