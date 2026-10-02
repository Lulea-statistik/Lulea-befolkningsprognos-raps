#!/usr/bin/env python3
"""Build model_data.json/js from SCB raw CSV extracts.

V1.3 intentionally creates a fully runnable demographic baseline from observed
SCB data before future national assumption tables are wired in. It calibrates
age/sex mortality, age-specific fertility and age/sex net migration for the
6-, 10- and 19-year windows ending 2024. The 2025 CKM observations are kept as
diagnostics/control data rather than mixed into the pre-CKM calibration.
"""
from __future__ import annotations

import csv
import json
import math
import re
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
OUT_JSON = ROOT / "data" / "model_data.json"
OUT_JS = ROOT / "data" / "model_data.js"

MUNICIPALITIES = {
    "2580": "Luleå kommun",
    "2582": "Bodens kommun",
    "2581": "Piteå kommun",
    "2560": "Älvsbyns kommun",
    "2514": "Kalix kommun",
}
FA_CODE = "FA_LULEA"
RIKET_CODE = "00"
WINDOWS = (6, 10, 19)
MIGRATION_WINDOWS = (2, 4, 6, 10)
RATIO_MIN = 0.50
RATIO_MAX = 1.50

# Fallback only when an official Raps cluster/parameter is unavailable.
# The local signal fades in smoothly with statistical information instead of
# switching abruptly from national to municipal data.
FADING_ZERO_LOCAL_EXPOSURE = 20.0
FADING_FULL_LOCAL_EXPOSURE = 100.0
FADING_ZERO_EXPECTED_EVENTS = 1.0
FADING_FULL_EXPECTED_EVENTS = 20.0
CALIBRATION_END = 2024
HISTORICAL_BIRTH_YEAR_EXPOSURE_FILE = "mean_population_pre2025.csv"
HISTORICAL_EVENT_AGE_EXPOSURE_FILE = "mean_population_event_age_pre2025.csv"
SEX_MAP = {"1": "M", "2": "K", "M": "M", "K": "K"}

# Same concepts in the pre-CKM and 2025 CKM tables.
IN_MIG_CODES = {"BE0101AU", "0000086B"}
OUT_MIG_CODES = {"BE0101AV", "0000086F"}
NET_MIG_CODES = {"BE0101AZ", "00000868"}

MIGRATION_LEG_CODES_PRE2025 = {
    "county": {
        "in": "000001E7",
        "out": "000001EA",
        "net": "000001EE",
    },
    "rest_sweden": {
        "in": "000001E8",
        "out": "000001E9",
        "net": "000001J5",
    },
    "international": {
        "in": "000001EB",
        "out": "000001EC",
        "net": "000001J6",
    },
}
MIGRATION_LEG_CODES_2025 = {
    "county": {
        "in": "0000087I",
        "out": "0000087N",
        "net": "0000087E",
    },
    "rest_sweden": {
        "in": "0000087J",
        "out": "0000087O",
        "net": "0000087F",
    },
    "international": {
        "in": "0000087K",
        "out": "0000087P",
        "net": "0000087H",
    },
}
MIGRATION_LEG_LABELS = {
    "county": "Övriga Norrbotten",
    "rest_sweden": "Övriga Sverige",
    "international": "Utlandet",
}

def sniff(path: Path):
    text = path.read_text(encoding="utf-8")
    try:
        return csv.Sniffer().sniff(text[:10000], delimiters=";,\t,")
    except csv.Error:
        return csv.excel

def rows(path: Path):
    dialect = sniff(path)
    with path.open("r", encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f, dialect=dialect)

def num(value) -> float:
    if value is None:
        return 0.0
    s = str(value).strip().replace(" ", "").replace(",", ".")
    if s in ("", "..", "-", "—"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0

def age_value(code: str) -> int | None:
    c = str(code).strip()
    if c in {"100+", "100+1"}:
        return 100
    if c.isdigit():
        n = int(c)
        return min(n, 100) if n >= 0 else None
    if c == "49+":
        return 49
    if c == "-15":
        return 15
    return None

def value_columns(fieldnames, content_codes=None):
    out = []
    for h in fieldnames or []:
        m = re.search(r"(19|20)\d{2}$", h or "")
        if not m:
            continue
        year = int(m.group(0))
        code = (h.rsplit(" ", 1)[0] if " " in h else "")
        if content_codes and code not in content_codes:
            continue
        out.append((h, code, year))
    return out

def manifest():
    path = RAW / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"files": {}}

def content_code_for(file_key: str, label_term: str) -> str | None:
    info = manifest().get("files", {}).get(file_key, {})
    labels_map = info.get("content_labels", {})
    term = label_term.lower()
    for code, label in labels_map.items():
        if term in str(label).lower():
            return code
    return None

def load_forecast_birth_counts(filename: str):
    """Aggregate national projected births across mother's birth regions by age/year."""
    path = RAW / filename
    out = defaultdict(float)
    if not path.exists():
        return out
    for r in rows(path):
        age = age_value(r.get("Alder", ""))
        if age is None or not (15 <= age <= 49):
            continue
        for col, _, year in value_columns(r.keys()):
            out[(year, age)] += num(r[col])
    return out

def load_forecast_detail(filename: str, file_key: str):
    """Aggregate projected deaths and mean population across birth regions."""
    path = RAW / filename
    deaths = defaultdict(float)
    exposure = defaultdict(float)
    if not path.exists():
        return deaths, exposure
    death_code = content_code_for(file_key, "döda")
    mean_code = content_code_for(file_key, "medelfolkmängd")
    if not death_code or not mean_code:
        raise RuntimeError(
            f"Could not identify Döda/Medelfolkmängd content codes for {file_key}."
        )
    for r in rows(path):
        age = age_value(r.get("Alder", ""))
        sex = SEX_MAP.get(r.get("Kon", ""))
        if age is None or not sex:
            continue
        for col, code, year in value_columns(r.keys(), {death_code, mean_code}):
            if code == death_code:
                deaths[(year, sex, age)] += num(r[col])
            elif code == mean_code:
                exposure[(year, sex, age)] += num(r[col])
    return deaths, exposure

def national_future_profiles(detail_filename: str, detail_key: str, births_filename: str):
    birth_counts = load_forecast_birth_counts(births_filename)
    deaths, exposure = load_forecast_detail(detail_filename, detail_key)
    fert = {}
    mort_hazard = {}
    years = sorted({y for y, _ in birth_counts} | {y for y, _, _ in deaths})
    for year in years:
        for age in range(15, 50):
            women = exposure.get((year, "K", age), 0.0)
            fert[(year, age)] = 0.0 if women <= 0 else birth_counts.get((year, age), 0.0) / women
        for sex in ("K", "M"):
            for age in range(101):
                p = exposure.get((year, sex, age), 0.0)
                mort_hazard[(year, sex, age)] = 0.0 if p <= 0 else deaths.get((year, sex, age), 0.0) / p
    return fert, mort_hazard

def fertility_scenario_rows(
    historical_fertility_rows,
    future_fert,
    scenario,
    source,
    start_year=2026,
):
    """Apply the existing local relative age pattern to another national path."""
    out = []
    base_fert = [r for r in historical_fertility_rows if "year" not in r]
    for r in base_fert:
        hist_nat = float(r.get("nationalRate") or 0.0)
        relative = 1.0 if hist_nat <= 0 else float(r.get("value") or 0.0) / hist_nat
        for (year, age), national_rate in future_fert.items():
            if year < start_year or age != int(r["age"]):
                continue
            out.append({
                "scenario": scenario,
                "geo": r["geo"],
                "window": r["window"],
                "year": year,
                "age": age,
                "value": max(0.0, national_rate * relative),
                "nationalRate": national_rate,
                "relativeHistoricalShape": relative,
                "source": source,
            })
    return out


def national_tfr_rows(scenarios):
    """Sum annual age-specific national fertility rates, ages 15-49."""
    rows_out = []
    for scenario, source, future_fert in scenarios:
        years = sorted({year for year, _ in future_fert})
        for year in years:
            rows_out.append({
                "scenario": scenario,
                "source": source,
                "year": year,
                "tfr": sum(
                    max(0.0, float(future_fert.get((year, age), 0.0)))
                    for age in range(15, 50)
                ),
            })
    return rows_out


def extend_profiles_with_future(fertility_rows, mortality_rows, future_fert, future_mort, start_year=2026):
    """Apply historical local relative shapes to annual SCB national future profiles."""
    fert_out = list(fertility_rows)
    mort_out = list(mortality_rows)

    base_fert = [r for r in fertility_rows if "year" not in r]
    for r in base_fert:
        hist_nat = float(r.get("nationalRate") or 0.0)
        relative = 1.0 if hist_nat <= 0 else float(r.get("value") or 0.0) / hist_nat
        for (year, age), national_rate in future_fert.items():
            if year < start_year or age != int(r["age"]):
                continue
            fert_out.append({
                "geo": r["geo"], "window": r["window"], "year": year,
                "age": age, "value": max(0.0, national_rate * relative),
                "nationalRate": national_rate,
                "relativeHistoricalShape": relative,
                "source": "SCB national forecast profile × local calibrated relative shape",
            })

    base_mort = [r for r in mortality_rows if "year" not in r]
    for r in base_mort:
        hist_nat = float(r.get("nationalHazard") or 0.0)
        local_risk = max(0.0, min(0.999999999, float(r.get("value") or 0.0)))
        local_hazard = -math.log(max(1e-12, 1.0 - local_risk))
        relative = 1.0 if hist_nat <= 0 else local_hazard / hist_nat
        for (year, sex, age), national_hazard in future_mort.items():
            if year < start_year or sex != r["sex"] or age != int(r["age"]):
                continue
            hazard = max(0.0, national_hazard * relative)
            mort_out.append({
                "geo": r["geo"], "window": r["window"], "year": year,
                "sex": sex, "age": age,
                "value": max(0.0, min(1.0, 1.0 - math.exp(-hazard))),
                "nationalHazard": national_hazard,
                "relativeHistoricalShape": relative,
                "source": "SCB national forecast hazard × local calibrated relative shape",
            })
    return fert_out, mort_out

def load_population_2025():
    path = RAW / "population_2025.csv"
    data = defaultdict(float)
    for r in rows(path):
        if "Civilstand" in r and r["Civilstand"] != "SC":
            continue
        age = age_value(r.get("Alder", ""))
        sex = SEX_MAP.get(r.get("Kon", ""))
        geo = r.get("Region")
        if age is None or not sex or geo not in set(MUNICIPALITIES) | {RIKET_CODE}:
            continue
        for col, _, year in value_columns(r.keys()):
            if year == 2025:
                data[(geo, sex, age)] += num(r[col])
    return data

def _allowed_geographies(allowed_geos=None):
    if allowed_geos is None:
        return set(MUNICIPALITIES) | {RIKET_CODE}
    return set(allowed_geos)

def load_wide_age_sex(filename: str, allowed_codes=None, allowed_geos=None):
    path = RAW / filename
    out = defaultdict(float)
    geos = _allowed_geographies(allowed_geos)
    for r in rows(path):
        age = age_value(r.get("Alder", ""))
        sex = SEX_MAP.get(r.get("Kon", ""))
        geo = r.get("Region")
        if age is None or not sex or geo not in geos:
            continue
        for col, code, year in value_columns(r.keys(), allowed_codes):
            out[(geo, year, sex, age)] += num(r[col])
    return out

def load_migration_legs(filename: str, code_map, allowed_geos=None):
    """Load migration split into county / rest of Sweden / international legs.

    The SCB table is also split by birth region. For the geographic migration
    legs we use only the row representing all birth regions to avoid double
    counting Swedish-born and foreign-born subtotals.
    """
    path = RAW / filename
    out = defaultdict(float)
    geos = _allowed_geographies(allowed_geos)
    reverse = {
        code: (leg, direction)
        for leg, directions in code_map.items()
        for direction, code in directions.items()
    }
    for r in rows(path):
        if r.get("Fodelseregion") not in ("samt", "SAMT", "Tot", "TOT", ""):
            continue
        age = age_value(r.get("Alder", ""))
        sex = SEX_MAP.get(r.get("Kon", ""))
        geo = r.get("Region")
        if age is None or not sex or geo not in geos:
            continue
        for col, code, year in value_columns(r.keys(), set(reverse)):
            leg_direction = reverse.get(code)
            if not leg_direction:
                continue
            leg, direction = leg_direction
            out[(geo, year, sex, age, leg, direction)] += num(r[col])
    return out


def load_births(filename: str, allowed_geos=None):
    path = RAW / filename
    out = defaultdict(float)
    geos = _allowed_geographies(allowed_geos)
    for r in rows(path):
        age = age_value(r.get("AlderModer", ""))
        geo = r.get("Region")
        if age is None or geo not in geos or not (15 <= age <= 49):
            continue
        # Sum boys + girls to births by mother's age.
        for col, _, year in value_columns(r.keys()):
            out[(geo, year, age)] += num(r[col])
    return out

def load_births_by_child_sex(filename: str):
    """Births by municipality, year and child's sex, without double-counting ages."""
    path = RAW / filename
    out = defaultdict(float)
    for r in rows(path):
        age = age_value(r.get("AlderModer", ""))
        geo = r.get("Region")
        sex = SEX_MAP.get(r.get("Kon", ""))
        if age is None or geo not in set(MUNICIPALITIES) | {RIKET_CODE} or not sex or not (15 <= age <= 49):
            continue
        for col, _, year in value_columns(r.keys()):
            out[(geo, year, sex)] += num(r[col])
    return out

def observed_male_birth_share(births_by_sex, years=range(2015, 2025)):
    male = female = 0.0
    for geo in MUNICIPALITIES:
        for year in years:
            male += births_by_sex.get((geo, year, "M"), 0)
            female += births_by_sex.get((geo, year, "K"), 0)
    total = male + female
    return 0.5 if total <= 0 else male / total

def aggregate_group_age_sex(source, group_code, members):
    member_set = set(members)
    out = defaultdict(float)
    for (geo, year, sex, age), value in source.items():
        out[(geo, year, sex, age)] += value
        if geo in member_set:
            out[(group_code, year, sex, age)] += value
    return out

def aggregate_group_births(source, group_code, members):
    member_set = set(members)
    out = defaultdict(float)
    for (geo, year, age), value in source.items():
        out[(geo, year, age)] += value
        if geo in member_set:
            out[(group_code, year, age)] += value
    return out

def aggregate_fa_age_sex(source):
    return aggregate_group_age_sex(source, FA_CODE, MUNICIPALITIES)

def aggregate_fa_births(source):
    return aggregate_group_births(source, FA_CODE, MUNICIPALITIES)

def clip_ratio(value):
    if not math.isfinite(value):
        return 1.0
    return max(RATIO_MIN, min(RATIO_MAX, value))

def _smooth_weight(value, zero_at, full_at):
    x = max(0.0, float(value or 0.0))
    if x <= zero_at:
        return 0.0
    if x >= full_at:
        return 1.0
    t = (x - zero_at) / (full_at - zero_at)
    return t * t * (3.0 - 2.0 * t)

def fallback_fading_weight(avg_annual_exposure, expected_events):
    """Outcome-independent local age-cell weight.

    Two ex-ante information requirements are combined:
    1) average annual local population/exposure in the cell;
    2) expected event count under national rates over the calibration window.

    A cell can reach 100% local weight only when both signals are sufficiently
    strong. This lets large, information-rich cells become fully local while
    rare-event cells (e.g. births to age 15) remain close to the national age
    profile even when the population denominator itself is not tiny.
    """
    w_exposure = _smooth_weight(
        avg_annual_exposure,
        FADING_ZERO_LOCAL_EXPOSURE,
        FADING_FULL_LOCAL_EXPOSURE,
    )
    w_events = _smooth_weight(
        expected_events,
        FADING_ZERO_EXPECTED_EVENTS,
        FADING_FULL_EXPECTED_EVENTS,
    )
    return w_exposure * w_events

def faded_ratio(raw_ratio, avg_annual_exposure, expected_events):
    w = fallback_fading_weight(avg_annual_exposure, expected_events)
    raw = 1.0 if not math.isfinite(raw_ratio) else raw_ratio
    applied = 1.0 + w * (raw - 1.0)
    return clip_ratio(applied), w

def fertility_factor(geo, window, births, exposure):
    yrs = set(window_years(window))
    observed = 0.0
    expected = 0.0
    for year in yrs:
        for age in range(15, 50):
            rb = births.get((RIKET_CODE, year, age), 0.0)
            rw = exposure.get((RIKET_CODE, year, "K", age), 0.0)
            national_rate = 0.0 if rw <= 0 else rb / rw
            local_women = exposure.get((geo, year, "K", age), 0.0)
            observed += births.get((geo, year, age), 0.0)
            expected += local_women * national_rate
    raw = 1.0 if expected <= 0 else observed / expected
    applied = clip_ratio(raw)
    return raw, applied, observed, expected, 1.0

def mortality_factor(geo, window, deaths, exposure):
    yrs = set(window_years(window))
    observed = 0.0
    expected = 0.0
    for year in yrs:
        for sex in ("K", "M"):
            for age in range(101):
                rd = deaths.get((RIKET_CODE, year, sex, age), 0.0)
                rp = exposure.get((RIKET_CODE, year, sex, age), 0.0)
                national_hazard = 0.0 if rp <= 0 else rd / rp
                local_pop = exposure.get((geo, year, sex, age), 0.0)
                observed += deaths.get((geo, year, sex, age), 0.0)
                expected += local_pop * national_hazard
    raw = 1.0 if expected <= 0 else observed / expected
    applied = clip_ratio(raw)
    return raw, applied, observed, expected, 1.0

def window_years(window):
    return range(CALIBRATION_END - window + 1, CALIBRATION_END + 1)

def mortality_profiles(deaths, exposure):
    result = []
    factors = []
    geos = list(MUNICIPALITIES) + [FA_CODE]
    for window in WINDOWS:
        yrs = set(window_years(window))
        for geo in geos:
            raw_factor, _, observed, expected, _ = mortality_factor(
                geo, window, deaths, exposure
            )
            # The broad municipality factor is the age-standardized local level
            # relative to Sweden. Age/sex-specific deviations are then faded
            # smoothly around this factor according to the cell information.
            general_factor = clip_ratio(raw_factor)
            factors.append({
                "geo": geo,
                "window": window,
                "raw": raw_factor,
                "applied": general_factor,
                "observedDeaths": observed,
                "expectedDeathsAtNationalRates": expected,
                "fallbackMethod": "general municipality ratio plus age/sex-specific fading toward the national profile",
            })
            for sex in ("K", "M"):
                for age in range(101):
                    d_riket = sum(deaths.get((RIKET_CODE, y, sex, age), 0) for y in yrs)
                    p_riket = sum(exposure.get((RIKET_CODE, y, sex, age), 0) for y in yrs)
                    national_hazard = 0.0 if p_riket <= 0 else d_riket / p_riket

                    local_deaths = sum(deaths.get((geo, y, sex, age), 0) for y in yrs)
                    local_exposure = sum(exposure.get((geo, y, sex, age), 0) for y in yrs)
                    expected_cell = local_exposure * national_hazard
                    local_hazard = 0.0 if local_exposure <= 0 else local_deaths / local_exposure

                    base_hazard = national_hazard * general_factor
                    if national_hazard <= 0 or base_hazard <= 0:
                        cell_weight = 0.0
                        blended_hazard = base_hazard
                        raw_cell_factor = general_factor
                    else:
                        raw_cell_factor = local_hazard / national_hazard if local_exposure > 0 else general_factor
                        avg_annual_exposure = local_exposure / float(window)
                        cell_weight = fallback_fading_weight(
                            avg_annual_exposure, expected_cell
                        )
                        # Blend the local age/sex deviation around the general
                        # municipality factor. Sparse cells stay on the
                        # national age profile scaled by the general factor.
                        local_target = national_hazard * clip_ratio(raw_cell_factor)
                        blended_hazard = (1 - cell_weight) * base_hazard + cell_weight * local_target

                    risk = max(0.0, min(1.0, 1 - math.exp(-max(0.0, blended_hazard))))
                    result.append({
                        "geo": geo, "window": window, "sex": sex,
                        "age": age, "value": risk,
                        "nationalHazard": national_hazard,
                        "municipalityFactor": general_factor,
                        "rawCellFactor": raw_cell_factor,
                        "cellExpectedEvents": expected_cell,
                        "cellAverageAnnualExposure": avg_annual_exposure if national_hazard > 0 and base_hazard > 0 else (local_exposure / float(window)),
                        "cellLocalWeight": cell_weight,
                    })
    return result, factors

def fertility_profiles(births, exposure):
    result = []
    factors = []
    geos = list(MUNICIPALITIES) + [FA_CODE]
    for window in WINDOWS:
        yrs = set(window_years(window))
        for geo in geos:
            raw_factor, _, observed, expected, _ = fertility_factor(
                geo, window, births, exposure
            )
            general_factor = clip_ratio(raw_factor)
            factors.append({
                "geo": geo,
                "window": window,
                "raw": raw_factor,
                "applied": general_factor,
                "observedBirths": observed,
                "expectedBirthsAtNationalRates": expected,
                "fallbackMethod": "general municipality ratio plus maternal-age fading toward the national profile",
            })
            for age in range(15, 50):
                b_riket = sum(births.get((RIKET_CODE, y, age), 0) for y in yrs)
                w_riket = sum(exposure.get((RIKET_CODE, y, "K", age), 0) for y in yrs)
                national_rate = 0.0 if w_riket <= 0 else b_riket / w_riket

                local_births = sum(births.get((geo, y, age), 0) for y in yrs)
                local_women = sum(exposure.get((geo, y, "K", age), 0) for y in yrs)
                expected_cell = local_women * national_rate
                local_rate = 0.0 if local_women <= 0 else local_births / local_women

                base_rate = national_rate * general_factor
                if national_rate <= 0 or base_rate <= 0:
                    cell_weight = 0.0
                    blended_rate = base_rate
                    raw_cell_factor = general_factor
                else:
                    raw_cell_factor = local_rate / national_rate if local_women > 0 else general_factor
                    avg_annual_exposure = local_women / float(window)
                    cell_weight = fallback_fading_weight(
                        avg_annual_exposure, expected_cell
                    )
                    local_target = national_rate * clip_ratio(raw_cell_factor)
                    blended_rate = (1 - cell_weight) * base_rate + cell_weight * local_target

                result.append({
                    "geo": geo, "window": window, "age": age,
                    "value": max(0.0, blended_rate),
                    "nationalRate": national_rate,
                    "municipalityFactor": general_factor,
                    "rawCellFactor": raw_cell_factor,
                    "cellExpectedEvents": expected_cell,
                    "cellAverageAnnualExposure": avg_annual_exposure if national_rate > 0 and base_rate > 0 else (local_women / float(window)),
                    "cellLocalWeight": cell_weight,
                })
    return result, factors

def migration_age_diagnostics(inflow, outflow, netmig):
    """Age-specific historical migration variation and practical sensitivity.

    These are diagnostics, not confidence intervals. Variation is the observed
    annual standard deviation over each calibration window. A 5 percent
    sensitivity translates stream size into persons/year so small flows do not
    look important merely because their percentage variation is high.
    """
    result = []
    geos = list(MUNICIPALITIES) + [FA_CODE]
    for window in MIGRATION_WINDOWS:
        yrs = list(window_years(window))
        for geo in geos:
            age_rows = []
            gross_available = geo != FA_CODE
            for age in range(101):
                ins, outs, nets = [], [], []
                for year in yrs:
                    if gross_available:
                        ins.append(sum(inflow.get((geo, year, sex, age), 0.0) for sex in ("K", "M")))
                        outs.append(sum(outflow.get((geo, year, sex, age), 0.0) for sex in ("K", "M")))
                    nets.append(sum(netmig.get((geo, year, sex, age), 0.0) for sex in ("K", "M")))
                mean_in = statistics.fmean(ins) if ins else None
                mean_out = statistics.fmean(outs) if outs else None
                mean_net = statistics.fmean(nets) if nets else 0.0
                sd_in = statistics.pstdev(ins) if len(ins) > 1 else None
                sd_out = statistics.pstdev(outs) if len(outs) > 1 else None
                sd_net = statistics.pstdev(nets) if len(nets) > 1 else 0.0
                age_rows.append({
                    "geo": geo,
                    "window": window,
                    "age": age,
                    "grossFlowsAvailable": gross_available,
                    "meanInflow": mean_in,
                    "meanOutflow": mean_out,
                    "meanNetMigration": mean_net,
                    "sdInflow": sd_in,
                    "sdOutflow": sd_out,
                    "sdNetMigration": sd_net,
                    "cvNetMigrationPct": None if abs(mean_net) < 1e-12 else 100.0 * sd_net / abs(mean_net),
                    "sensitivity5PctNetPersons": abs(mean_net) * 0.05,
                    "cvInflowPct": None if mean_in is None or abs(mean_in) < 1e-12 else 100.0 * sd_in / abs(mean_in),
                    "cvOutflowPct": None if mean_out is None or abs(mean_out) < 1e-12 else 100.0 * sd_out / abs(mean_out),
                    "sensitivity5PctInflowPersons": None if mean_in is None else abs(mean_in) * 0.05,
                    "sensitivity5PctOutflowPersons": None if mean_out is None else abs(mean_out) * 0.05,
                })
            total_in = sum((r["meanInflow"] or 0.0) for r in age_rows)
            total_out = sum((r["meanOutflow"] or 0.0) for r in age_rows)
            for r in age_rows:
                r["shareOfInflowPct"] = None if not gross_available else (0.0 if total_in <= 0 else 100.0 * r["meanInflow"] / total_in)
                r["shareOfOutflowPct"] = None if not gross_available else (0.0 if total_out <= 0 else 100.0 * r["meanOutflow"] / total_out)
                r["sensitivity5PctShareOfTotalInflowPct"] = (
                    None if not gross_available else
                    (0.0 if total_in <= 0 else
                     100.0 * r["sensitivity5PctInflowPersons"] / total_in)
                )
                result.append(r)
    return result

def load_worker_age_groups():
    """Average employed persons by workplace municipality, sex and broad age group."""
    path = RAW / "employment_age_profile.csv"
    out = {}
    if not path.exists():
        return out

    groups = ((15, 24), (25, 54), (55, 74))
    values_by_cell = defaultdict(list)

    for r in rows(path):
        geo = r.get("Region")
        sex = SEX_MAP.get(r.get("Kon", ""))
        if geo not in MUNICIPALITIES or not sex:
            continue
        m = re.match(r"^(\d{1,2})-(\d{1,2})$", str(r.get("Alder", "")).strip())
        if not m:
            continue
        grp = (int(m.group(1)), int(m.group(2)))
        if grp not in groups:
            continue
        for col, _, year in value_columns(r.keys()):
            if 2022 <= year <= 2024:
                values_by_cell[(geo, sex, grp[0], grp[1])].append(num(r[col]))

    for geo in MUNICIPALITIES:
        cell_means = {}
        for sex in ("K", "M"):
            for age_min, age_max in groups:
                vals = values_by_cell.get((geo, sex, age_min, age_max), [])
                cell_means[(sex, age_min, age_max)] = (
                    statistics.fmean(vals) if vals else 0.0
                )
        total = sum(cell_means.values())
        if total <= 0:
            continue
        out[geo] = {
            key: value / total
            for key, value in cell_means.items()
        }
    return out

def scenario_migration_profiles(inflow):
    """Scenario priors for age/sex distribution of new residents.

    observed_inflow:
        all observed municipal in-migrants.
    job_family:
        legacy sensitivity profile using observed in-migration ages 0-64.
    worker_hybrid:
        workplace employment age/sex shares from SCB TAB3205, disaggregated
        to single-year ages using the municipality's observed in-migration
        pattern within each sex x broad age group.
    family_companion:
        descriptive household-companion proxy based on observed in-migration
        ages 0-17 and 25-64. Ages 18-24 are excluded to reduce university-
        driven student bias in workplace scenarios.

    These are scenario priors, not causal estimates of job-induced migration.
    Gross FA inflow is not produced because municipal gross flows would
    double-count moves within the FA region.
    """
    result = []
    worker_groups = load_worker_age_groups()
    broad_groups = ((15, 24), (25, 54), (55, 74))

    for window in WINDOWS:
        yrs = set(window_years(window))
        for geo in MUNICIPALITIES:
            cells = {}
            for sex in ("K", "M"):
                for age in range(101):
                    cells[(sex, age)] = sum(
                        inflow.get((geo, y, sex, age), 0.0) for y in yrs
                    )

            # Existing descriptive sensitivity profiles.
            for mode, allowed in (
                ("observed_inflow", lambda age: 0 <= age <= 100),
                ("job_family", lambda age: 0 <= age <= 64),
                ("family_companion", lambda age: age <= 17 or 25 <= age <= 64),
            ):
                total = sum(
                    value for (sex, age), value in cells.items()
                    if allowed(age)
                )
                if total > 0:
                    for sex in ("K", "M"):
                        for age in range(101):
                            value = cells[(sex, age)] if allowed(age) else 0.0
                            result.append({
                                "geo": geo,
                                "window": window,
                                "profile": mode,
                                "sex": sex,
                                "age": age,
                                "share": value / total,
                            })

            # Worker profile: preserve SCB workplace broad age/sex structure,
            # but use local observed in-migration to distribute within group.
            targets = worker_groups.get(geo)
            if not targets:
                continue
            worker_rows = []
            for sex in ("K", "M"):
                for age_min, age_max in broad_groups:
                    target_share = targets.get((sex, age_min, age_max), 0.0)
                    if target_share <= 0:
                        continue
                    local_total = sum(
                        cells[(sex, age)]
                        for age in range(age_min, age_max + 1)
                    )
                    width = age_max - age_min + 1
                    for age in range(age_min, age_max + 1):
                        within_share = (
                            cells[(sex, age)] / local_total
                            if local_total > 0
                            else 1.0 / width
                        )
                        worker_rows.append((sex, age, target_share * within_share))

            total_worker_share = sum(v for _, _, v in worker_rows)
            if total_worker_share > 0:
                by_cell = defaultdict(float)
                for sex, age, value in worker_rows:
                    by_cell[(sex, age)] += value / total_worker_share
                for sex in ("K", "M"):
                    for age in range(101):
                        result.append({
                            "geo": geo,
                            "window": window,
                            "profile": "worker_hybrid",
                            "sex": sex,
                            "age": age,
                            "share": by_cell.get((sex, age), 0.0),
                        })
    return result

def young_adult_migration_diagnostics(inflow, outflow, netmig):
    """Describe Lulea's young-adult migration pattern without assigning status.

    Age is the model variable. The 19-20 inflow peak and 24-25 outflow peak are
    shown explicitly because they are large in Lulea, but no individual is
    classified as a student from age alone.
    """
    geo = "2580"
    groups = (
        ("entry_19_20", "19–20 år, tydlig inflyttningsålder", 19, 20),
        ("young_adult_19_25", "19–25 år, bred kontrollgrupp", 19, 25),
        ("exit_24_25", "24–25 år, tydlig utflyttningsålder", 24, 25),
    )
    annual = []
    years = range(2006, CALIBRATION_END + 1)
    for key, label, amin, amax in groups:
        for year in years:
            incoming = sum(
                inflow.get((geo, year, sex, age), 0.0)
                for sex in ("K", "M") for age in range(amin, amax + 1)
            )
            outgoing = sum(
                outflow.get((geo, year, sex, age), 0.0)
                for sex in ("K", "M") for age in range(amin, amax + 1)
            )
            net = sum(
                netmig.get((geo, year, sex, age), 0.0)
                for sex in ("K", "M") for age in range(amin, amax + 1)
            )
            annual.append({
                "group": key, "label": label, "year": year,
                "inflow": incoming, "outflow": outgoing, "netMigration": net,
            })

    summaries = []
    for key, label, amin, amax in groups:
        group_rows = [r for r in annual if r["group"] == key]
        for window in MIGRATION_WINDOWS:
            start_year = CALIBRATION_END - window + 1
            rr = [r for r in group_rows if r["year"] >= start_year]
            nets = [r["netMigration"] for r in rr]
            ins = [r["inflow"] for r in rr]
            outs = [r["outflow"] for r in rr]
            summaries.append({
                "group": key,
                "label": label,
                "ageMin": amin,
                "ageMax": amax,
                "window": window,
                "meanInflow": statistics.fmean(ins) if ins else 0.0,
                "meanOutflow": statistics.fmean(outs) if outs else 0.0,
                "meanNetMigration": statistics.fmean(nets) if nets else 0.0,
                "sdNetMigration": statistics.pstdev(nets) if len(nets) > 1 else 0.0,
                "latestYearInflow": ins[-1] if ins else None,
                "latestYearOutflow": outs[-1] if outs else None,
                "latestYearNetMigration": nets[-1] if nets else None,
            })
    return {
        "geo": geo,
        "annual": annual,
        "summaries": summaries,
        "interpretation": (
            "The diagnostic describes observed age-specific flows only. "
            "Large flows at ages 19-20 and 24-25 must remain visible in the "
            "one-year-age migration profile regardless of their underlying cause."
        ),
    }


def _migration_leg_total(data, geo, year, leg, direction, amin=0, amax=100):
    return sum(
        data.get((geo, year, sex, age, leg, direction), 0.0)
        for sex in ("K", "M")
        for age in range(amin, amax + 1)
    )


def migration_leg_diagnostics(pre2025, current2025=None):
    """Three-leg migration diagnostics and component-specific window backtests.

    Legs:
      county        = moves to/from other municipalities in Norrbotten
      rest_sweden   = moves to/from other Swedish counties
      international = immigration/emigration

    The rolling component test uses only migration observations available at
    each origin. n+1 is primary, n+2 secondary.
    """
    geos = list(MUNICIPALITIES)
    result = {
        "labels": MIGRATION_LEG_LABELS,
        "windows": list(MIGRATION_WINDOWS),
        "summaries": [],
        "ageProfilesLulea": [],
        "windowBacktestLulea": [],
        "observed2025": [],
        "faPrinciple": (
            "For Lulea FA, county-leg gross flows cannot be summed across member "
            "municipalities because internal FA moves would be double-counted. "
            "County-leg net can be summed because internal moves cancel. "
            "Other-Sweden and international gross flows can be summed."
        ),
    }

    for geo in geos:
        for window in MIGRATION_WINDOWS:
            years = list(window_years(window))
            for leg in MIGRATION_LEG_LABELS:
                vals = {}
                for direction in ("in", "out", "net"):
                    annual = [
                        _migration_leg_total(pre2025, geo, y, leg, direction)
                        for y in years
                    ]
                    vals[direction] = statistics.fmean(annual) if annual else 0.0
                result["summaries"].append({
                    "geo": geo,
                    "window": window,
                    "leg": leg,
                    "label": MIGRATION_LEG_LABELS[leg],
                    "meanInflow": vals["in"],
                    "meanOutflow": vals["out"],
                    "meanNetMigration": vals["net"],
                })

    # Lulea one-year age pattern by migration leg.
    geo = "2580"
    for window in MIGRATION_WINDOWS:
        years = list(window_years(window))
        for leg in MIGRATION_LEG_LABELS:
            for age in range(101):
                ins = [
                    sum(pre2025.get((geo, y, sex, age, leg, "in"), 0.0) for sex in ("K", "M"))
                    for y in years
                ]
                outs = [
                    sum(pre2025.get((geo, y, sex, age, leg, "out"), 0.0) for sex in ("K", "M"))
                    for y in years
                ]
                nets = [
                    sum(pre2025.get((geo, y, sex, age, leg, "net"), 0.0) for sex in ("K", "M"))
                    for y in years
                ]
                result["ageProfilesLulea"].append({
                    "window": window,
                    "leg": leg,
                    "label": MIGRATION_LEG_LABELS[leg],
                    "age": age,
                    "meanInflow": statistics.fmean(ins) if ins else 0.0,
                    "meanOutflow": statistics.fmean(outs) if outs else 0.0,
                    "meanNetMigration": statistics.fmean(nets) if nets else 0.0,
                })

    # Vintage-correct migration-only backtest for each leg and direction.
    for origin in (2018, 2019, 2020, 2021):
        for window in MIGRATION_WINDOWS:
            calibration_years = range(origin - window + 1, origin + 1)
            for leg in MIGRATION_LEG_LABELS:
                for direction in ("in", "out", "net"):
                    predicted = statistics.fmean([
                        _migration_leg_total(pre2025, geo, y, leg, direction)
                        for y in calibration_years
                    ])
                    for horizon in (1, 2):
                        actual_year = origin + horizon
                        actual = _migration_leg_total(
                            pre2025, geo, actual_year, leg, direction
                        )
                        result["windowBacktestLulea"].append({
                            "origin": origin,
                            "horizon": horizon,
                            "year": actual_year,
                            "window": window,
                            "leg": leg,
                            "label": MIGRATION_LEG_LABELS[leg],
                            "direction": direction,
                            "predicted": predicted,
                            "actual": actual,
                            "error": predicted - actual,
                            "absoluteError": abs(predicted - actual),
                        })

    if current2025:
        for geo in geos:
            for leg in MIGRATION_LEG_LABELS:
                result["observed2025"].append({
                    "geo": geo,
                    "year": 2025,
                    "leg": leg,
                    "label": MIGRATION_LEG_LABELS[leg],
                    "inflow": _migration_leg_total(current2025, geo, 2025, leg, "in"),
                    "outflow": _migration_leg_total(current2025, geo, 2025, leg, "out"),
                    "netMigration": _migration_leg_total(current2025, geo, 2025, leg, "net"),
                    "note": "SCB CKM 2025; diagnostic only, not calibration input.",
                })
    return result



def outmigration_risk_profiles(outflow, exposure):
    """Historical municipal out-migration risks (urisk) by age and sex.

    Gross municipal outflows are valid at municipality level. They are not
    aggregated to FA_LULEA because moves between member municipalities would
    otherwise be counted as external out-migration from the FA region.
    """
    result = []
    for window in MIGRATION_WINDOWS:
        yrs = set(window_years(window))
        for geo in MUNICIPALITIES:
            for sex in ("K", "M"):
                for age in range(101):
                    events = sum(outflow.get((geo, y, sex, age), 0.0) for y in yrs)
                    pop = sum(exposure.get((geo, y, sex, age), 0.0) for y in yrs)
                    hazard = 0.0 if pop <= 0 else events / pop
                    risk = 0.0 if hazard <= 0 else 1.0 - math.exp(-hazard)
                    result.append({
                        "geo": geo,
                        "window": window,
                        "sex": sex,
                        "age": age,
                        "value": max(0.0, min(1.0, risk)),
                        "events": events,
                        "exposure": pop,
                        "annualMeanOutflow": events / float(window),
                        "method": "1-exp(-U/P)",
                    })
    return result

def gross_inmigration_profiles(inflow):
    """Observed annual mean gross in-migration by municipality, age and sex.

    These rows are model-building inputs for a future IMIG specification. They
    remain descriptive in V1 and are deliberately not created for FA_LULEA.
    """
    result = []
    for window in MIGRATION_WINDOWS:
        yrs = set(window_years(window))
        for geo in MUNICIPALITIES:
            for sex in ("K", "M"):
                for age in range(101):
                    total = sum(inflow.get((geo, y, sex, age), 0.0) for y in yrs)
                    result.append({
                        "geo": geo,
                        "window": window,
                        "year": "BASE",
                        "sex": sex,
                        "age": age,
                        "value": total / float(window),
                        "totalObserved": total,
                        "method": "historical annual mean gross in-migration",
                    })
    return result

def migration_profiles(netmig):
    result = []
    geos = list(MUNICIPALITIES) + [FA_CODE]
    for window in MIGRATION_WINDOWS:
        yrs = set(window_years(window))
        denom = float(window)
        for geo in geos:
            for sex in ("K", "M"):
                for age in range(101):
                    total = sum(netmig.get((geo, y, sex, age), 0) for y in yrs)
                    result.append({
                        "geo": geo, "window": window, "year": "BASE",
                        "sex": sex, "age": age, "value": total / denom,
                    })
    return result

def add_fa_population(base):
    out = dict(base)
    for sex in ("K", "M"):
        for age in range(101):
            out[(FA_CODE, sex, age)] = sum(
                base.get((geo, sex, age), 0) for geo in MUNICIPALITIES
            )
    return out

def migration_2025_diagnostics(netmig_2025, migration_rows):
    """Fresh post-calibration comparison of 2025 net migration.

    Historical profiles end in 2024. The 2025 CKM observation is therefore not
    used to fit the 2/4/6/10/19-year profiles and is retained as a one-year
    diagnostic only. Aggregate CKM perturbation is not assumed to be +/-3.
    """
    result = []
    if not netmig_2025:
        return result
    for geo in list(MUNICIPALITIES) + [FA_CODE]:
        actual = sum(
            value for (g, year, sex, age), value in netmig_2025.items()
            if g == geo and year == 2025
        )
        by_window = {}
        for window in MIGRATION_WINDOWS:
            predicted = sum(
                float(r.get("value") or 0.0)
                for r in migration_rows
                if r["geo"] == geo and int(r["window"]) == window
            )
            by_window[str(window)] = {
                "predictedAnnualNetMigration": predicted,
                "actualNetMigration2025": actual,
                "error": predicted - actual,
                "absoluteError": abs(predicted - actual),
            }
        result.append({
            "geo": geo,
            "year": 2025,
            "method": "post-2024 calibration diagnostic; observed value uses SCB CKM",
            "actualNetMigration": actual,
            "windows": by_window,
            "note": "2025 is not used to fit these profiles. Aggregate CKM uncertainty is not treated as +/-3."
        })
    return result


def ckm_diagnostics(base, deaths_2025, netmig_2025):
    diagnostics = []
    for geo in list(MUNICIPALITIES) + [FA_CODE]:
        pop_total = sum(v for (g, _, _), v in base.items() if g == geo)
        if pop_total:
            diagnostics.append({
                "geo": geo, "year": 2025, "metric": "population_total",
                "value": pop_total,
                "maxRelativePctSingleCell": 100 * 3 / pop_total,
                "note": "Indicative only; aggregate CKM uncertainty is not bounded by ±3."
            })
    return diagnostics

def main():
    required = [
        "population_2025.csv", HISTORICAL_BIRTH_YEAR_EXPOSURE_FILE,
        HISTORICAL_EVENT_AGE_EXPOSURE_FILE,
        "migration_pre2025.csv", "births_pre2025.csv",
        "deaths_pre2025.csv"
    ]
    missing = [p for p in required if not (RAW / p).exists()]
    if missing:
        raise SystemExit("Missing raw SCB files: " + ", ".join(missing))

    base = add_fa_population(load_population_2025())
    # Exposure denominators must match the event's age convention.
    # Deaths (TAB959) and migration (TAB1212) are classified by attained age
    # at year-end / birth-year age, so they use TAB2818.
    birth_year_exposure = aggregate_fa_age_sex(
        load_wide_age_sex(HISTORICAL_BIRTH_YEAR_EXPOSURE_FILE)
    )
    # Births (TAB1264) use the mother's age at the birth event, so fertility
    # uses SCB's mean population by age during the year (TAB2819).
    fertility_exposure = aggregate_fa_age_sex(
        load_wide_age_sex(HISTORICAL_EVENT_AGE_EXPOSURE_FILE)
    )
    deaths = aggregate_fa_age_sex(load_wide_age_sex("deaths_pre2025.csv"))
    births = aggregate_fa_births(load_births("births_pre2025.csv"))
    births_by_sex = load_births_by_child_sex("births_pre2025.csv")
    male_birth_share = observed_male_birth_share(births_by_sex)
    inflow = aggregate_fa_age_sex(
        load_wide_age_sex("migration_pre2025.csv", IN_MIG_CODES)
    )
    outflow = aggregate_fa_age_sex(
        load_wide_age_sex("migration_pre2025.csv", OUT_MIG_CODES)
    )
    netmig = aggregate_fa_age_sex(
        load_wide_age_sex("migration_pre2025.csv", NET_MIG_CODES)
    )
    migration_legs_pre2025 = load_migration_legs(
        "migration_birth_region_pre2025.csv",
        MIGRATION_LEG_CODES_PRE2025,
        allowed_geos=MUNICIPALITIES,
    )

    deaths_2025 = {}
    netmig_2025 = {}
    if (RAW / "deaths_2025.csv").exists():
        deaths_2025 = aggregate_fa_age_sex(load_wide_age_sex("deaths_2025.csv"))
    if (RAW / "migration_2025.csv").exists():
        netmig_2025 = aggregate_fa_age_sex(
            load_wide_age_sex("migration_2025.csv", NET_MIG_CODES)
        )
    migration_legs_2025 = {}
    if (RAW / "migration_birth_region_2025.csv").exists():
        migration_legs_2025 = load_migration_legs(
            "migration_birth_region_2025.csv",
            MIGRATION_LEG_CODES_2025,
            allowed_geos=MUNICIPALITIES,
        )

    fertility_rates, fertility_factors = fertility_profiles(births, fertility_exposure)
    mortality_risks, mortality_factors = mortality_profiles(deaths, birth_year_exposure)
    net_migration_profiles = migration_profiles(netmig)

    future_fert, future_mort = national_future_profiles(
        "raps_national_detail_2024.csv",
        "raps_national_detail_2024",
        "raps_births_2024.csv",
    )
    historical_fertility_rows = list(fertility_rates)
    fertility_scenario_rates = []
    fertility_scenarios = []
    fertility_scenario_tfr = []

    if future_fert and future_mort:
        fertility_rates, mortality_risks = extend_profiles_with_future(
            fertility_rates, mortality_risks, future_fert, future_mort, start_year=2026
        )
        future_profile_mode = "SCB 2024 annual national profiles × local relative shape"
        fertility_scenarios.append({
            "id": "raps2024",
            "label": "Raps/SCB 2024 (bas)",
            "isBaseline": True,
            "source": "SCB 2024 national forecast used by the Raps reference baseline",
        })
    else:
        future_profile_mode = "Historical national profile held constant (fallback)"

    latest_fert, _latest_mort = national_future_profiles(
        "national_forecast_detail.csv",
        "national_forecast_detail",
        "national_forecast_births.csv",
    )
    if latest_fert:
        fertility_scenario_rates.extend(
            fertility_scenario_rows(
                historical_fertility_rows,
                latest_fert,
                "scb2026",
                "SCB Sveriges framtida befolkning 2026 national fertility profile × unchanged local calibrated relative shape",
                start_year=2026,
            )
        )
        fertility_scenarios.append({
            "id": "scb2026",
            "label": "SCB 2026 – aktuell nationell bana",
            "isBaseline": False,
            "source": "SCB Sveriges framtida befolkning 2026",
            "changes": "fertility only; mortality and migration remain at baseline assumptions",
        })

    fertility_scenario_tfr = national_tfr_rows([
        (
            "raps2024",
            "SCB 2024 Raps reference",
            future_fert,
        ),
        (
            "scb2026",
            "SCB 2026 current national projection",
            latest_fert,
        ),
    ])

    model = {
        "meta": {
            "schemaVersion": "0.13.0",
            "generatedBy": "scripts/build_model_data.py",
            "dataReady": True,
            "baseYear": 2025,
            "projectionAssumptionVersion": "scb2024-national-trend-local-ratio-v2-event-age",
            "methodBreakYear": 2025,
            "methodBreak": "SCB Cell Key Method (CKM)",
            "calibrationEndYear": CALIBRATION_END,
            "exposurePopulation": {
                "birthYearAge": {
                    "sourceKey": "mean_population_pre2025",
                    "scbTable": "TAB2818",
                    "usedFor": ["mortality", "out-migration risk"],
                    "ageConvention": "attained age at year-end / birth-year age",
                },
                "eventAge": {
                    "sourceKey": "mean_population_event_age_pre2025",
                    "scbTable": "TAB2819",
                    "usedFor": ["fertility by mother's age at birth"],
                    "ageConvention": "age during the year / age at event",
                },
                "stockPopulation": {
                    "sourceKey": "population_2025",
                    "usedFor": ["reported population stock", "forecast base population"],
                    "referenceTime": "31 December",
                },
            },
            "note": (
                "Baseline fertility and mortality use annual SCB 2024 national forecast profiles "
                "multiplied by locally calibrated municipality/FA relative shapes. "
                "SCB 2026 is stored as a fertility-only sensitivity path using the same local calibration. "
                "Cohorts are aged to forecast-year/event age before fertility and mortality are applied. "
                "Newborns are included before age-0 mortality. Small age cells fade toward the national age profile. "
                "Historical municipal "
                "urisk and gross inflow profiles are stored as migration-building inputs, while "
                "the published V1 baseline still uses locally calibrated net migration."
            ),
        },
        "geographies": [
            {"code": FA_CODE, "name": "Luleå FA",
             "members": list(MUNICIPALITIES)},
            *[{"code": c, "name": n} for c, n in MUNICIPALITIES.items()],
        ],
        "calibration": {
            "defaultYears": 10,
            "options": list(WINDOWS),
            "preCkmEnd": 2024,
            "ckmStart": 2025,
            "ckmCellDelta": 3,
        },
        "parameters": {
            "cohortTimingMode": "event_age_aligned",
            "qutbMode": "identity",
            "endogenousInMigration": False,
            "endogenousOutMigration": False,
            "uriskMode": "historical municipal gross-outflow risk; diagnostic until UMIG is enabled",
            "imigMode": "historical municipal gross-inflow profile; diagnostic until IMIG is enabled",
            "iflMode": "deferred",
            "sexRatioMaleAtBirth": 0.515,
            "sexRatioMaleAtBirthSource": "Raps technical specification: 0.515 boys / 0.485 girls",
            "observedMaleBirthShareFA2015_2024": male_birth_share,
            "relativeToNationalMethod": "General age-standardized municipality/FA ratio to Sweden",
            "futureNationalProfileMode": future_profile_mode,
            "defaultFertilityScenario": "raps2024",
            "scenarioMigrationProfileMethod": (
                "Workplace scenarios support a worker hybrid profile based on SCB TAB3205 "
                "employment age/sex shares, disaggregated to one-year ages with observed "
                "municipal in-migration. Household companions use a separate descriptive "
                "proxy excluding the high-flow young-adult ages 18-24. Scenario priors are not causal estimates."
            ),
        },
        "populationBase": [
            {"geo": geo, "year": 2025, "sex": sex, "age": age, "value": value}
            for (geo, sex, age), value in sorted(base.items())
        ],
        "fertilityRates": fertility_rates,
        "fertilityScenarioRates": fertility_scenario_rates,
        "fertilityScenarios": fertility_scenarios,
        "fertilityScenarioNationalTFR": fertility_scenario_tfr,
        "mortalityRisks": mortality_risks,
        "netMigration": net_migration_profiles,
        "outMigrationRisks": outmigration_risk_profiles(outflow, birth_year_exposure),
        "grossInMigration": gross_inmigration_profiles(inflow),
        "scenarioMigrationProfiles": scenario_migration_profiles(inflow),
        "diagnostics": {
            "ckm": ckm_diagnostics(base, deaths_2025, netmig_2025),
            "migration2025Validation": migration_2025_diagnostics(
                netmig_2025, net_migration_profiles
            ),
            "calibrationWindows": list(WINDOWS),
            "migrationCalibrationWindows": list(MIGRATION_WINDOWS),
            "relativeFactors": {
                "fertility": fertility_factors,
                "mortality": mortality_factors,
                "bounds": {"min": RATIO_MIN, "max": RATIO_MAX},
                "method": "Observed / expected at national age-specific rates",
                "fallbackFading": {
                    "enabledOnlyWhenOfficialRapsParameterUnavailable": True,
                    "weightDependsOnOutcome": False,
                    "zeroLocalExposure": FADING_ZERO_LOCAL_EXPOSURE,
                    "fullLocalExposure": FADING_FULL_LOCAL_EXPOSURE,
                    "zeroExpectedEvents": FADING_ZERO_EXPECTED_EVENTS,
                    "fullExpectedEvents": FADING_FULL_EXPECTED_EVENTS,
                    "maxLocalWeight": 1.0,
                    "formula": "w=smoothstep(avgAnnualExposure,20,100)*smoothstep(expectedEvents,1,20); cellRate=(1-w)*(nationalRate*generalFactor)+w*localCellRate",
                    "governance": "Thresholds are fixed before benchmark evaluation and must not be tuned to improve backtest results."
                }
            },
            "faNetMigrationPrinciple": (
                "Municipal net migration is summed to FA because internal "
                "municipal moves cancel in the net."
            ),
            "migrationByAge": migration_age_diagnostics(inflow, outflow, netmig),
            "youngAdultMigration": young_adult_migration_diagnostics(inflow, outflow, netmig),
            "migrationLegs": migration_leg_diagnostics(
                migration_legs_pre2025, migration_legs_2025
            ),
            "migrationUncertaintyNote": (
                "Historical standard deviations and percentage sensitivities are diagnostics, "
                "not statistical confidence intervals. Gross inflow/outflow are not shown for FA "
                "because municipal gross flows contain internal FA moves; FA net migration remains valid."
            ),
        },
    }

    OUT_JSON.write_text(
        json.dumps(model, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    OUT_JS.write_text(
        "window.MODEL_DATA = " +
        json.dumps(model, ensure_ascii=False, separators=(",", ":")) +
        ";\n",
        encoding="utf-8",
    )

    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")
    print(f"Wrote {OUT_JS.relative_to(ROOT)}")
    print(f"Observed male birth share 2015-2024: {male_birth_share:.6f}")
    for window in WINDOWS:
        print(
            f"window={window}: fertility={sum(1 for r in model['fertilityRates'] if r['window']==window)}, "
            f"mortality={sum(1 for r in model['mortalityRisks'] if r['window']==window)}, "
            f"migration={sum(1 for r in model['netMigration'] if r['window']==window)}, "
            f"urisk={sum(1 for r in model['outMigrationRisks'] if r['window']==window)}, "
            f"gross_in={sum(1 for r in model['grossInMigration'] if r['window']==window)}"
        )

if __name__ == "__main__":
    main()
