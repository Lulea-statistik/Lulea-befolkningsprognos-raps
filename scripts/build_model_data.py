#!/usr/bin/env python3
"""Build model_data.json/js from SCB raw CSV extracts.

V1.3 intentionally creates a fully runnable demographic baseline from observed
SCB data before future national assumption tables are wired in. It calibrates
age/sex mortality, age-specific fertility and age/sex net migration for the
3-, 6- and 10-year windows ending 2024. The 2025 CKM observations are kept as
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
SMOOTHING_DIAGNOSTIC_JSON = ROOT / "data" / "backtests" / "migration_age_smoothing.json"
SMOOTHING_DIAGNOSTIC_JS = ROOT / "data" / "backtests" / "migration_age_smoothing.js"

MUNICIPALITIES = {
    "2580": "Luleå kommun",
    "2582": "Bodens kommun",
    "2581": "Piteå kommun",
    "2560": "Älvsbyns kommun",
    "2514": "Kalix kommun",
}
FA_CODE = "FA_LULEA"
RIKET_CODE = "00"
WINDOWS = (3, 6, 10)
MIGRATION_WINDOWS = (2, 3, 4, 6, 10)
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
MIGRATION_COMPONENT_CONFIG = ROOT / "data" / "migration_component_windows.json"
SCB_RISK_MIGRATION_CONFIG = ROOT / "data" / "scb_risk_migration_config.json"
MIGRATION_RECENCY_CANDIDATE_CONFIG = ROOT / "data" / "migration_recency_candidate.json"

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

def load_forecast_migration_context(filename: str, file_key: str):
    """Load national immigration totals and mean population by age/sex.

    SCB national projection detail tables contain Inflyttade and
    Medelfolkmängd by birth region, sex and age. Summing birth regions gives
    the national immigration volume and national age/sex risk population
    needed by the regional-style migration candidate.
    """
    path = RAW / filename
    immigration = defaultdict(float)
    exposure = defaultdict(float)
    if not path.exists():
        return immigration, exposure
    in_code = content_code_for(file_key, "inflyttade")
    mean_code = content_code_for(file_key, "medelfolkmängd")
    if not in_code or not mean_code:
        raise RuntimeError(
            f"Could not identify Inflyttade/Medelfolkmängd content codes for {file_key}."
        )
    for r in rows(path):
        age = age_value(r.get("Alder", ""))
        sex = SEX_MAP.get(r.get("Kon", ""))
        if age is None or not sex:
            continue
        for col, code, year in value_columns(r.keys(), {in_code, mean_code}):
            value = num(r[col])
            if code == in_code:
                immigration[year] += value
            elif code == mean_code:
                exposure[(year, sex, age)] += value
    return immigration, exposure


def forecast_birth_dimension(file_key: str):
    """Return the birth-origin dimension used by a national forecast vintage.

    Older SCB vintages use Fodelselandgrupp while newer vintages use
    Fodelseregion. Both represent the same model state needed here.
    """
    dims = (
        manifest().get("files", {}).get(file_key, {})
        .get("dimension_value_labels", {})
    )
    for dim in ("Fodelseregion", "Fodelselandgrupp"):
        if dim in dims:
            return dim
    return None


def forecast_birth_status(file_key: str, raw_code: str):
    dim = forecast_birth_dimension(file_key)
    if not dim:
        return None
    labels = (
        manifest().get("files", {}).get(file_key, {})
        .get("dimension_value_labels", {}).get(dim, {})
    )
    label = str(labels.get(str(raw_code), "")).strip().lower()
    if (
        "födda i sverige" in label
        or "född i sverige" in label
        or label == "sverige"
    ):
        return "sweden_born"
    if label:
        return "foreign_born"
    return None


def load_forecast_migration_context_by_birth_status(
    filename: str, file_key: str
):
    """National future immigration and mean population by birth status."""
    path = RAW / filename
    immigration = defaultdict(float)
    exposure = defaultdict(float)
    if not path.exists():
        return immigration, exposure
    in_code = content_code_for(file_key, "inflyttade")
    mean_code = content_code_for(file_key, "medelfolkmängd")
    if not in_code or not mean_code:
        raise RuntimeError(
            f"Could not identify Inflyttade/Medelfolkmängd for {file_key}."
        )
    birth_dim = forecast_birth_dimension(file_key)
    if not birth_dim:
        raise RuntimeError(
            f"Could not identify birth-origin dimension for {file_key}."
        )
    for r in rows(path):
        status = forecast_birth_status(file_key, r.get(birth_dim, ""))
        age = age_value(r.get("Alder", ""))
        sex = SEX_MAP.get(r.get("Kon", ""))
        if not status or age is None or not sex:
            continue
        for col, code, year in value_columns(r.keys(), {in_code, mean_code}):
            value = num(r[col])
            if code == in_code:
                immigration[(year, status)] += value
            elif code == mean_code:
                exposure[(year, status, sex, age)] += value
    return immigration, exposure


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

    SCB also splits rows by birth region. Some vintages provide an explicit
    all-birth-regions row while older TAB4693 extracts provide Swedish-born
    and foreign-born rows only. Use the total row when available; otherwise
    sum the two mutually exclusive birth-region rows.
    """
    path = RAW / filename
    source_rows = list(rows(path))
    out = defaultdict(float)
    geos = _allowed_geographies(allowed_geos)
    reverse = {
        code: (leg, direction)
        for leg, directions in code_map.items()
        for direction, code in directions.items()
    }
    total_codes = {"samt", "SAMT", "Tot", "TOT", "TotSa", "TotSA", ""}
    has_total = any(str(r.get("Fodelseregion", "")).strip() in total_codes for r in source_rows)
    accepted_birth_regions = total_codes if has_total else {"09", "11"}

    for r in source_rows:
        if str(r.get("Fodelseregion", "")).strip() not in accepted_birth_regions:
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


def load_migration_legs_birth_status(
    filename: str, file_key: str, code_map, allowed_geos=None
):
    """Load migration legs retaining Swedish-/foreign-born status."""
    path = RAW / filename
    out = defaultdict(float)
    geos = _allowed_geographies(allowed_geos)
    reverse = {
        code: (leg, direction)
        for leg, directions in code_map.items()
        for direction, code in directions.items()
    }
    status_codes = birth_status_codes(file_key)
    reverse_status = {code: status for status, code in status_codes.items()}
    if set(reverse_status.values()) != {"sweden_born", "foreign_born"}:
        raise RuntimeError(
            f"Could not identify Swedish-/foreign-born codes for {file_key}."
        )

    for r in rows(path):
        status = reverse_status.get(str(r.get("Fodelseregion", "")).strip())
        if not status:
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
            out[(geo, year, sex, age, status, leg, direction)] += num(r[col])
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

def adaptive_migration_age_smoothing(pre2025, config):
    """Diagnostic selective smoothing of municipality migration age profiles.

    The raw municipality one-year-age profile is retained unless an age cell
    looks like an isolated local spike/trough that is weakly supported.

    The smoothing target is not the national level itself. It is:
        adjacent local-age mean + corresponding Sweden age curvature.

    This means an age discontinuity that also exists nationally remains
    structurally available, while only the municipality-specific excess
    curvature is eligible for smoothing.

    Two independent signals protect the raw local age cell:
      1) information: mean annual local events in the cell;
      2) persistence: whether the local excess curvature repeats over years.

    Local retention is the union of those two signals:
        1 - (1-information) * (1-persistence)

    Therefore strong event support OR stable repetition is enough to preserve
    a local one-year-age feature. Smoothing becomes strong only when both are
    weak. This is diagnostic only and is not active in the forecast engine.
    """
    smoothing = config.get("ageProfileSmoothing") or {}
    window = int(smoothing.get("profileWindow", 9))
    prior_annual_events = max(
        0.0, float(smoothing.get("priorAnnualEvents", 20))
    )
    radius = max(1, int(smoothing.get("neighborRadius", 1)))
    years = list(window_years(window))

    def event_value(geo, year, sex, age, leg, direction):
        if leg == "all":
            return sum(
                pre2025.get(
                    (geo, year, sex, age, one_leg, direction), 0.0
                )
                for one_leg in MIGRATION_LEG_LABELS
            )
        return pre2025.get(
            (geo, year, sex, age, leg, direction), 0.0
        )

    result = []
    for geo in MUNICIPALITIES:
        for leg in (*MIGRATION_LEG_LABELS.keys(), "all"):
            leg_label = (
                "Alla flyttben"
                if leg == "all"
                else MIGRATION_LEG_LABELS[leg]
            )
            for direction in ("in", "out"):
                local_year_totals = {}
                national_year_totals = {}
                for year in years:
                    local_year_totals[year] = sum(
                        event_value(
                            geo, year, sex, age, leg, direction
                        )
                        for sex in ("K", "M")
                        for age in range(101)
                    )
                    national_year_totals[year] = sum(
                        event_value(
                            RIKET_CODE, year, sex, age, leg, direction
                        )
                        for sex in ("K", "M")
                        for age in range(101)
                    )

                local_total = sum(local_year_totals.values())
                national_total = sum(national_year_totals.values())
                national_available = national_total > 0
                annual_local_mean = (
                    local_total / float(window)
                    if window > 0 else 0.0
                )

                cells = {}
                for sex in ("K", "M"):
                    for age in range(101):
                        local_events = sum(
                            event_value(
                                geo, y, sex, age, leg, direction
                            )
                            for y in years
                        )
                        national_events = sum(
                            event_value(
                                RIKET_CODE, y, sex, age, leg, direction
                            )
                            for y in years
                        )
                        raw_share = (
                            0.0 if local_total <= 0
                            else local_events / local_total
                        )
                        national_share = (
                            raw_share
                            if national_total <= 0
                            else national_events / national_total
                        )
                        mean_annual_events = (
                            local_events / float(window)
                            if window > 0 else 0.0
                        )
                        information = (
                            1.0
                            if prior_annual_events <= 0
                            else mean_annual_events / (
                                mean_annual_events + prior_annual_events
                            )
                        )
                        cells[(sex, age)] = {
                            "localEvents": local_events,
                            "meanAnnualEvents": mean_annual_events,
                            "rawShare": raw_share,
                            "nationalShare": national_share,
                            "informationWeight": information,
                        }

                for sex in ("K", "M"):
                    for age in range(101):
                        cell = cells[(sex, age)]

                        local_neighbors = []
                        national_neighbors = []
                        for delta in range(-radius, radius + 1):
                            if delta == 0:
                                continue
                            other_age = age + delta
                            if 0 <= other_age <= 100:
                                local_neighbors.append(
                                    cells[(sex, other_age)]["rawShare"]
                                )
                                national_neighbors.append(
                                    cells[(sex, other_age)][
                                        "nationalShare"
                                    ]
                                )
                        neighbor_local = (
                            statistics.fmean(local_neighbors)
                            if local_neighbors
                            else cell["rawShare"]
                        )
                        neighbor_national = (
                            statistics.fmean(national_neighbors)
                            if national_neighbors
                            else cell["nationalShare"]
                        )

                        national_curvature = (
                            cell["nationalShare"] - neighbor_national
                        )
                        structural_target = max(
                            0.0,
                            neighbor_local + national_curvature,
                        )
                        excess_curvature = (
                            cell["rawShare"] - structural_target
                        )

                        annual_excess = []
                        for year in years:
                            lt = local_year_totals[year]
                            nt = national_year_totals[year]
                            if lt <= 0:
                                continue

                            local_share_y = (
                                event_value(
                                    geo, year, sex, age,
                                    leg, direction
                                ) / lt
                            )
                            national_share_y = (
                                event_value(
                                    RIKET_CODE, year, sex, age,
                                    leg, direction
                                ) / nt
                                if nt > 0
                                else cell["nationalShare"]
                            )

                            local_neighbor_y = []
                            national_neighbor_y = []
                            for delta in range(-radius, radius + 1):
                                if delta == 0:
                                    continue
                                other_age = age + delta
                                if not (0 <= other_age <= 100):
                                    continue
                                local_neighbor_y.append(
                                    event_value(
                                        geo, year, sex, other_age,
                                        leg, direction
                                    ) / lt
                                )
                                if nt > 0:
                                    national_neighbor_y.append(
                                        event_value(
                                            RIKET_CODE, year, sex,
                                            other_age, leg, direction
                                        ) / nt
                                    )

                            ln = (
                                statistics.fmean(local_neighbor_y)
                                if local_neighbor_y
                                else local_share_y
                            )
                            nn = (
                                statistics.fmean(national_neighbor_y)
                                if national_neighbor_y
                                else national_share_y
                            )
                            annual_excess.append(
                                (local_share_y - ln)
                                - (national_share_y - nn)
                            )

                        mean_excess = (
                            statistics.fmean(annual_excess)
                            if annual_excess else 0.0
                        )
                        sd_excess = (
                            statistics.pstdev(annual_excess)
                            if len(annual_excess) > 1 else 0.0
                        )
                        signal = abs(mean_excess)
                        persistence = (
                            0.0
                            if signal + sd_excess <= 1e-15
                            else signal / (signal + sd_excess)
                        )
                        info = cell["informationWeight"]
                        smoothing_weight = (
                            (1.0 - info) * (1.0 - persistence)
                        )
                        retention = 1.0 - smoothing_weight

                        cell.update({
                            "neighborLocalShare": neighbor_local,
                            "neighborNationalShare": neighbor_national,
                            "nationalCurvature": national_curvature,
                            "structuralTargetShare": structural_target,
                            "excessLocalCurvature": excess_curvature,
                            "meanAnnualExcessCurvature": mean_excess,
                            "sdAnnualExcessCurvature": sd_excess,
                            "persistenceWeight": persistence,
                            "localRetentionWeight": retention,
                            "smoothingWeight": smoothing_weight,
                        })

                candidates = {}
                for sex in ("K", "M"):
                    for age in range(101):
                        cell = cells[(sex, age)]
                        candidate = (
                            cell["localRetentionWeight"]
                            * cell["rawShare"]
                            + cell["smoothingWeight"]
                            * cell["structuralTargetShare"]
                        )
                        candidates[(sex, age)] = max(0.0, candidate)

                candidate_total = sum(candidates.values())
                for sex in ("K", "M"):
                    for age in range(101):
                        cell = cells[(sex, age)]
                        smooth_share = (
                            cell["rawShare"]
                            if candidate_total <= 0
                            else candidates[(sex, age)] / candidate_total
                        )
                        raw_persons = (
                            annual_local_mean * cell["rawShare"]
                        )
                        smooth_persons = (
                            annual_local_mean * smooth_share
                        )
                        result.append({
                            "geo": geo,
                            "window": window,
                            "leg": leg,
                            "label": leg_label,
                            "direction": direction,
                            "sex": sex,
                            "age": age,
                            "nationalAvailable": national_available,
                            "localEvents": cell["localEvents"],
                            "meanAnnualEvents": cell[
                                "meanAnnualEvents"
                            ],
                            "rawShare": cell["rawShare"],
                            "nationalShare": cell[
                                "nationalShare"
                            ],
                            "neighborLocalShare": cell[
                                "neighborLocalShare"
                            ],
                            "neighborNationalShare": cell[
                                "neighborNationalShare"
                            ],
                            "nationalCurvature": cell[
                                "nationalCurvature"
                            ],
                            "structuralTargetShare": cell[
                                "structuralTargetShare"
                            ],
                            "excessLocalCurvature": cell[
                                "excessLocalCurvature"
                            ],
                            "meanAnnualExcessCurvature": cell[
                                "meanAnnualExcessCurvature"
                            ],
                            "sdAnnualExcessCurvature": cell[
                                "sdAnnualExcessCurvature"
                            ],
                            "informationWeight": cell[
                                "informationWeight"
                            ],
                            "persistenceWeight": cell[
                                "persistenceWeight"
                            ],
                            "localRetentionWeight": cell[
                                "localRetentionWeight"
                            ],
                            "smoothingWeight": cell[
                                "smoothingWeight"
                            ],
                            # Backward-compatible aliases for the current
                            # dashboard until the diagnostic UI is updated.
                            "directLocalWeight": cell[
                                "localRetentionWeight"
                            ],
                            "neighborLocalWeight": cell[
                                "smoothingWeight"
                            ],
                            "nationalWeight": 0.0,
                            "smoothedShare": smooth_share,
                            "rawMeanPersons": raw_persons,
                            "smoothedMeanPersons": smooth_persons,
                            "smoothingDifferencePersons": (
                                smooth_persons - raw_persons
                            ),
                            "status": (
                                "diagnostic_only_not_active_in_forecast"
                            ),
                        })

    return {
        "status": "diagnostic_only_not_active_in_forecast",
        "window": window,
        "priorAnnualEvents": prior_annual_events,
        "neighborRadius": radius,
        "method": smoothing.get("method"),
        "smoothingTarget": smoothing.get("smoothingTarget"),
        "structuralBreakProtection": smoothing.get(
            "structuralBreakProtection"
        ),
        "rows": result,
    }


def compact_migration_smoothing_diagnostic(diag, geo="2580"):
    """Small audit file for the adaptive migration-age smoothing diagnostic."""
    rows = [
        r for r in (diag.get("rows") or [])
        if r.get("geo") == geo and r.get("leg") == "all"
    ]
    grouped = []
    for direction in ("in", "out"):
        for age in range(101):
            rr = [
                r for r in rows
                if r.get("direction") == direction and int(r.get("age", -1)) == age
            ]
            if not rr:
                continue
            local_events = sum(float(r.get("localEvents") or 0.0) for r in rr)
            weight_den = local_events if local_events > 0 else float(len(rr))

            def weighted(field):
                if not rr:
                    return 0.0
                if local_events > 0:
                    return sum(
                        float(r.get(field) or 0.0) * float(r.get("localEvents") or 0.0)
                        for r in rr
                    ) / weight_den
                return sum(float(r.get(field) or 0.0) for r in rr) / weight_den

            raw = sum(float(r.get("rawMeanPersons") or 0.0) for r in rr)
            smooth = sum(float(r.get("smoothedMeanPersons") or 0.0) for r in rr)
            grouped.append({
                "direction": direction,
                "age": age,
                "rawMeanPersons": raw,
                "smoothedMeanPersons": smooth,
                "differencePersons": smooth - raw,
                "absoluteDifferencePersons": abs(smooth - raw),
                "localEvents": local_events,
                "localRetentionWeight": weighted("localRetentionWeight"),
                "smoothingWeight": weighted("smoothingWeight"),
                "persistenceWeight": weighted("persistenceWeight"),
                "informationWeight": weighted("informationWeight"),
            })

    largest = sorted(
        grouped,
        key=lambda r: r["absoluteDifferencePersons"],
        reverse=True,
    )[:20]
    ages_of_interest = set([18, 19, 20, 24, 25, 55, 56, 57, 63, 64, 65, 66, 67])
    selected = [
        r for r in grouped
        if r["age"] in ages_of_interest
    ]
    leg_weight_rows = [
        {
            "geo": r.get("geo"),
            "window": r.get("window"),
            "leg": r.get("leg"),
            "label": r.get("label"),
            "direction": r.get("direction"),
            "sex": r.get("sex"),
            "age": r.get("age"),
            "localRetentionWeight": r.get("localRetentionWeight"),
            "smoothingWeight": r.get("smoothingWeight"),
            "informationWeight": r.get("informationWeight"),
            "persistenceWeight": r.get("persistenceWeight"),
            "meanAnnualEvents": r.get("meanAnnualEvents"),
            "localEvents": r.get("localEvents"),
        }
        for r in (diag.get("rows") or [])
        if r.get("leg") in MIGRATION_LEG_LABELS
    ]

    return {
        "schemaVersion": "0.2.0",
        "status": diag.get("status"),
        "geo": geo,
        "window": diag.get("window"),
        "priorAnnualEvents": diag.get("priorAnnualEvents"),
        "neighborRadius": diag.get("neighborRadius"),
        "method": diag.get("method"),
        "smoothingTarget": diag.get("smoothingTarget"),
        "structuralBreakProtection": diag.get("structuralBreakProtection"),
        "largestChanges": largest,
        "agesOfInterest": selected,
        "allAgeDirectionRows": grouped,
        "legSexLocalWeightRows": leg_weight_rows,
        "localWeightInterpretation": (
            "Diagnostic local retention weight from adaptive migration-age "
            "smoothing. 0 means the cell relies fully on the structural "
            "neighbor/national target; 1 means the raw local age/sex cell is "
            "retained. This is not active in the production net10 forecast."
        ),
        "productionDefaultChanged": False,
    }


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

def migration_component_profiles(pre2025, exposure):
    """Build age/sex component inputs for a separate three-leg migration engine.

    In-migration is stored as the historical annual mean for each leg/window.
    Out-migration is stored as a hazard (events / exposure), not as three
    independently applied probabilities. The simulation combines the selected
    leg hazards first and converts their sum to one total out-migration risk.
    This guarantees that component outflows cannot remove more people than are
    present in an age/sex cell.
    """
    inflow_rows = []
    out_hazard_rows = []
    for window in MIGRATION_WINDOWS:
        yrs = set(window_years(window))
        for geo in MUNICIPALITIES:
            for leg in MIGRATION_LEG_LABELS:
                for sex in ("K", "M"):
                    for age in range(101):
                        incoming = sum(
                            pre2025.get((geo, y, sex, age, leg, "in"), 0.0)
                            for y in yrs
                        )
                        outgoing = sum(
                            pre2025.get((geo, y, sex, age, leg, "out"), 0.0)
                            for y in yrs
                        )
                        pop = sum(
                            exposure.get((geo, y, sex, age), 0.0)
                            for y in yrs
                        )
                        inflow_rows.append({
                            "geo": geo,
                            "leg": leg,
                            "window": window,
                            "sex": sex,
                            "age": age,
                            "value": incoming / float(window),
                            "totalObserved": incoming,
                            "method": "historical annual mean by geographic migration leg",
                        })
                        out_hazard_rows.append({
                            "geo": geo,
                            "leg": leg,
                            "window": window,
                            "sex": sex,
                            "age": age,
                            "value": 0.0 if pop <= 0 else outgoing / pop,
                            "events": outgoing,
                            "exposure": pop,
                            "method": "leg-specific hazard U/P; selected leg hazards are combined before risk conversion",
                        })
    return inflow_rows, out_hazard_rows


def migration_recency_out_hazards(pre2025, exposure, config):
    """Adaptive rest-of-Sweden out-migration hazards for a diagnostic candidate.

    The rule is locked in data/migration_recency_candidate.json. It is applied
    identically to every municipality, sex and one-year age; there are no
    age-specific overrides.
    """
    candidate = config["candidate"]
    leg = candidate["adaptiveLeg"]
    long_window = int(candidate["longWindow"])
    recent_window = int(candidate["recentWindow"])
    prior = float(candidate["priorAnnualEvents"])
    long_years = list(window_years(long_window))
    recent_years = list(window_years(recent_window))
    rows_out = []

    for geo in MUNICIPALITIES:
        for sex in ("K", "M"):
            for age in range(101):
                annual_hazards = []
                annual_events = []
                for year in long_years:
                    events = pre2025.get((geo, year, sex, age, leg, "out"), 0.0)
                    pop = exposure.get((geo, year, sex, age), 0.0)
                    annual_events.append(events)
                    annual_hazards.append(0.0 if pop <= 0 else events / pop)

                long_events = sum(annual_events)
                long_pop = sum(
                    exposure.get((geo, year, sex, age), 0.0)
                    for year in long_years
                )
                recent_events = sum(
                    pre2025.get((geo, year, sex, age, leg, "out"), 0.0)
                    for year in recent_years
                )
                recent_pop = sum(
                    exposure.get((geo, year, sex, age), 0.0)
                    for year in recent_years
                )
                long_hazard = 0.0 if long_pop <= 0 else long_events / long_pop
                recent_hazard = 0.0 if recent_pop <= 0 else recent_events / recent_pop
                delta = recent_hazard - long_hazard
                sd = statistics.pstdev(annual_hazards) if len(annual_hazards) > 1 else 0.0
                if abs(delta) <= 1e-15:
                    shift_strength = 0.0
                elif sd <= 1e-15:
                    shift_strength = 1.0
                else:
                    shift_strength = abs(delta) / (abs(delta) + sd)
                mean_events = statistics.fmean(annual_events) if annual_events else 0.0
                information = (
                    0.0 if mean_events <= 0
                    else mean_events / (mean_events + prior)
                )
                weight = max(0.0, min(1.0, shift_strength * information))
                value = long_hazard + weight * delta
                rows_out.append({
                    "geo": geo,
                    "leg": leg,
                    "sex": sex,
                    "age": age,
                    "value": value,
                    "longHazard": long_hazard,
                    "recentHazard": recent_hazard,
                    "adaptiveWeight": weight,
                    "annualHazardSd": sd,
                    "annualMeanEvents": mean_events,
                    "method": "adaptive recency hazard; locked rest_sweden outflow candidate",
                })
    return rows_out


def scb_risk_migration_profiles(pre2025, exposure, config):
    """Build a development candidate based on SCB's regional migration method.

    Domestic in-migration is split into two distinct pieces, matching SCB's
    published method more closely:
      1) a municipality/leg total in-migration risk against the population in
         the rest of Sweden; and
      2) a municipality/leg age-sex distribution estimated on a longer window.

    Domestic out-migration and emigration remain age/sex risks against the
    municipality's own exposure. Immigration is represented by the
    municipality's historical share of national immigration and a
    municipality-specific age/sex distribution.

    The method and windows are read from a configuration locked before
    evaluation. These rows are development inputs and do not change the
    production migration baseline.
    """
    domestic_in_levels = []
    domestic_in_distribution = []
    out_risks = []
    international_in = []

    domestic_in_window = int(config["methodBasis"]["internalInMigrationWindow"])
    domestic_age_window = int(
        config["methodBasis"]["internalInAgeSexDistributionWindow"]
    )
    domestic_out_window = int(config["methodBasis"]["internalOutMigrationWindow"])
    intl_share_window = int(
        config["methodBasis"]["internationalInMunicipalityShareWindow"]
    )
    intl_age_window = int(
        config["methodBasis"]["inMigrationAgeSexDistributionWindow"]
    )
    intl_out_window = int(
        config["methodBasis"]["internationalOutMigrationWindow"]
    )

    for geo in MUNICIPALITIES:
        # Domestic flows: same-county and other-Sweden are separate legs but
        # use the same SCB method.
        for leg in ("county", "rest_sweden"):
            in_years = set(window_years(domestic_in_window))
            age_years = set(window_years(domestic_age_window))
            out_years = set(window_years(domestic_out_window))

            incoming_total = sum(
                pre2025.get((geo, y, sex, age, leg, "in"), 0.0)
                for y in in_years
                for sex in ("K", "M")
                for age in range(101)
            )
            local_total_exposure = sum(
                exposure.get((geo, y, sex, age), 0.0)
                for y in in_years
                for sex in ("K", "M")
                for age in range(101)
            )
            national_total_exposure = sum(
                exposure.get((RIKET_CODE, y, sex, age), 0.0)
                for y in in_years
                for sex in ("K", "M")
                for age in range(101)
            )
            rest_total_exposure = max(
                0.0, national_total_exposure - local_total_exposure
            )
            total_in_risk = (
                0.0
                if rest_total_exposure <= 0
                else incoming_total / rest_total_exposure
            )
            domestic_in_levels.append({
                "geo": geo,
                "leg": leg,
                "window": domestic_in_window,
                "value": max(0.0, total_in_risk),
                "events": incoming_total,
                "riskExposure": rest_total_exposure,
                "riskPopulation": "rest_of_sweden_total",
                "method": "SCB-style domestic total in-migration risk",
            })

            distribution_total = sum(
                pre2025.get((geo, y, sex, age, leg, "in"), 0.0)
                for y in age_years
                for sex in ("K", "M")
                for age in range(101)
            )
            for sex in ("K", "M"):
                for age in range(101):
                    cell_events = sum(
                        pre2025.get((geo, y, sex, age, leg, "in"), 0.0)
                        for y in age_years
                    )
                    share = (
                        0.0
                        if distribution_total <= 0
                        else cell_events / distribution_total
                    )
                    domestic_in_distribution.append({
                        "geo": geo,
                        "leg": leg,
                        "sex": sex,
                        "age": age,
                        "window": domestic_age_window,
                        "share": max(0.0, share),
                        "events": cell_events,
                        "totalEvents": distribution_total,
                        "method": "SCB-style domestic in-migrant age/sex distribution",
                    })

                    outgoing = sum(
                        pre2025.get((geo, y, sex, age, leg, "out"), 0.0)
                        for y in out_years
                    )
                    local_out_exposure = sum(
                        exposure.get((geo, y, sex, age), 0.0)
                        for y in out_years
                    )
                    out_risk = (
                        0.0
                        if local_out_exposure <= 0
                        else outgoing / local_out_exposure
                    )
                    out_risks.append({
                        "geo": geo,
                        "leg": leg,
                        "sex": sex,
                        "age": age,
                        "window": domestic_out_window,
                        "value": max(0.0, min(1.0, out_risk)),
                        "rawRisk": max(0.0, out_risk),
                        "events": outgoing,
                        "riskExposure": local_out_exposure,
                        "riskPopulation": "municipality",
                        "method": "SCB-style domestic out-migration risk",
                    })

        # International in-migration: municipality share of national
        # immigration x municipality-specific age/sex distribution.
        share_years = set(window_years(intl_share_window))
        age_years = set(window_years(intl_age_window))
        local_share_events = sum(
            pre2025.get((geo, y, sex, age, "international", "in"), 0.0)
            for y in share_years
            for sex in ("K", "M")
            for age in range(101)
        )
        national_share_events = sum(
            pre2025.get((RIKET_CODE, y, sex, age, "international", "in"), 0.0)
            for y in share_years
            for sex in ("K", "M")
            for age in range(101)
        )
        municipality_share = (
            0.0
            if national_share_events <= 0
            else local_share_events / national_share_events
        )
        local_age_total = sum(
            pre2025.get((geo, y, sex, age, "international", "in"), 0.0)
            for y in age_years
            for sex in ("K", "M")
            for age in range(101)
        )
        for sex in ("K", "M"):
            for age in range(101):
                cell_events = sum(
                    pre2025.get((geo, y, sex, age, "international", "in"), 0.0)
                    for y in age_years
                )
                age_sex_share = (
                    0.0
                    if local_age_total <= 0
                    else cell_events / local_age_total
                )
                international_in.append({
                    "geo": geo,
                    "sex": sex,
                    "age": age,
                    "municipalityShare": max(0.0, municipality_share),
                    "municipalityShareWindow": intl_share_window,
                    "ageSexShare": max(0.0, age_sex_share),
                    "ageSexWindow": intl_age_window,
                    "localShareEvents": local_share_events,
                    "nationalShareEvents": national_share_events,
                    "cellEvents": cell_events,
                    "localAgeSexEvents": local_age_total,
                    "method": "SCB-style national immigration share x local age/sex distribution",
                })

        # International out-migration: municipality age/sex risk.
        out_years = set(window_years(intl_out_window))
        for sex in ("K", "M"):
            for age in range(101):
                outgoing = sum(
                    pre2025.get((geo, y, sex, age, "international", "out"), 0.0)
                    for y in out_years
                )
                local_exposure = sum(
                    exposure.get((geo, y, sex, age), 0.0)
                    for y in out_years
                )
                out_risk = (
                    0.0
                    if local_exposure <= 0
                    else outgoing / local_exposure
                )
                out_risks.append({
                    "geo": geo,
                    "leg": "international",
                    "sex": sex,
                    "age": age,
                    "window": intl_out_window,
                    "value": max(0.0, min(1.0, out_risk)),
                    "rawRisk": max(0.0, out_risk),
                    "events": outgoing,
                    "riskExposure": local_exposure,
                    "riskPopulation": "municipality",
                    "method": "SCB-style emigration risk",
                })

    return (
        domestic_in_levels,
        domestic_in_distribution,
        out_risks,
        international_in,
    )

def profet_birth_status_profiles(
    migration_status, population_status, config, geos=None
):
    """Build a Profet-like migration candidate retaining birth status.

    This stage changes only the migration/population-state dimension.
    Fertility and mortality remain the same as in the production engine.
    """
    method = config["migration"]
    in_window = int(method["domesticInRiskWindow"])
    age_window = int(method["domesticInAgeSexDistributionWindow"])
    out_window = int(method["domesticOutRiskWindow"])
    intl_share_window = int(method["internationalShareWindow"])
    intl_age_window = int(method["internationalAgeSexDistributionWindow"])
    intl_out_window = int(method["internationalOutRiskWindow"])
    statuses = ("sweden_born", "foreign_born")

    domestic_in_levels = []
    domestic_in_distribution = []
    out_risks = []
    international_in = []

    profile_geos = list(geos or MUNICIPALITIES)
    for geo in profile_geos:
        for status in statuses:
            for leg in ("county", "rest_sweden"):
                in_years = list(window_years(in_window))
                age_years = list(window_years(age_window))
                out_years = list(window_years(out_window))

                incoming = sum(
                    migration_status.get(
                        (geo, y, sex, age, status, leg, "in"), 0.0
                    )
                    for y in in_years
                    for sex in ("K", "M")
                    for age in range(101)
                )
                local_exposure = sum(
                    population_status.get(
                        (geo, y, sex, age, status), 0.0
                    )
                    for y in in_years
                    for sex in ("K", "M")
                    for age in range(101)
                )
                national_exposure = sum(
                    population_status.get(
                        (RIKET_CODE, y, sex, age, status), 0.0
                    )
                    for y in in_years
                    for sex in ("K", "M")
                    for age in range(101)
                )
                rest_exposure = max(0.0, national_exposure - local_exposure)
                domestic_in_levels.append({
                    "geo": geo,
                    "status": status,
                    "leg": leg,
                    "window": in_window,
                    "value": 0.0 if rest_exposure <= 0 else incoming / rest_exposure,
                    "events": incoming,
                    "riskExposure": rest_exposure,
                    "riskPopulation": "rest_of_sweden_same_birth_status",
                    "method": "Profet-stage birth-status domestic in-migration risk",
                })

                dist_total = sum(
                    migration_status.get(
                        (geo, y, sex, age, status, leg, "in"), 0.0
                    )
                    for y in age_years
                    for sex in ("K", "M")
                    for age in range(101)
                )
                for sex in ("K", "M"):
                    for age in range(101):
                        cell_in = sum(
                            migration_status.get(
                                (geo, y, sex, age, status, leg, "in"), 0.0
                            )
                            for y in age_years
                        )
                        domestic_in_distribution.append({
                            "geo": geo,
                            "status": status,
                            "leg": leg,
                            "sex": sex,
                            "age": age,
                            "window": age_window,
                            "share": 0.0 if dist_total <= 0 else cell_in / dist_total,
                            "events": cell_in,
                            "totalEvents": dist_total,
                            "method": "Profet-stage birth-status age/sex in-migrant distribution",
                        })

                        outgoing = sum(
                            migration_status.get(
                                (geo, y, sex, age, status, leg, "out"), 0.0
                            )
                            for y in out_years
                        )
                        exposure = sum(
                            population_status.get(
                                (geo, y, sex, age, status), 0.0
                            )
                            for y in out_years
                        )
                        out_risks.append({
                            "geo": geo,
                            "status": status,
                            "leg": leg,
                            "sex": sex,
                            "age": age,
                            "window": out_window,
                            "value": 0.0 if exposure <= 0 else outgoing / exposure,
                            "events": outgoing,
                            "riskExposure": exposure,
                            "riskPopulation": "municipality_same_birth_status",
                            "method": "Profet-stage birth-status domestic out-migration risk",
                        })

            # International in-migration: national immigration within birth
            # status x municipal share within the same status x local age/sex.
            share_years = list(window_years(intl_share_window))
            age_years = list(window_years(intl_age_window))
            local_in = sum(
                migration_status.get(
                    (geo, y, sex, age, status, "international", "in"), 0.0
                )
                for y in share_years
                for sex in ("K", "M")
                for age in range(101)
            )
            national_in = sum(
                migration_status.get(
                    (RIKET_CODE, y, sex, age, status, "international", "in"), 0.0
                )
                for y in share_years
                for sex in ("K", "M")
                for age in range(101)
            )
            municipal_share = 0.0 if national_in <= 0 else local_in / national_in
            local_age_total = sum(
                migration_status.get(
                    (geo, y, sex, age, status, "international", "in"), 0.0
                )
                for y in age_years
                for sex in ("K", "M")
                for age in range(101)
            )
            for sex in ("K", "M"):
                for age in range(101):
                    cell_in = sum(
                        migration_status.get(
                            (geo, y, sex, age, status, "international", "in"), 0.0
                        )
                        for y in age_years
                    )
                    international_in.append({
                        "geo": geo,
                        "status": status,
                        "sex": sex,
                        "age": age,
                        "municipalityShare": municipal_share,
                        "municipalityShareWindow": intl_share_window,
                        "ageSexShare": 0.0 if local_age_total <= 0 else cell_in / local_age_total,
                        "ageSexWindow": intl_age_window,
                        "localShareEvents": local_in,
                        "nationalShareEvents": national_in,
                        "cellEvents": cell_in,
                        "localAgeSexEvents": local_age_total,
                        "method": "Profet-stage birth-status national immigration share x local age/sex",
                    })

                    outgoing = sum(
                        migration_status.get(
                            (geo, y, sex, age, status, "international", "out"), 0.0
                        )
                        for y in window_years(intl_out_window)
                    )
                    exposure = sum(
                        population_status.get(
                            (geo, y, sex, age, status), 0.0
                        )
                        for y in window_years(intl_out_window)
                    )
                    out_risks.append({
                        "geo": geo,
                        "status": status,
                        "leg": "international",
                        "sex": sex,
                        "age": age,
                        "window": intl_out_window,
                        "value": 0.0 if exposure <= 0 else outgoing / exposure,
                        "events": outgoing,
                        "riskExposure": exposure,
                        "riskPopulation": "municipality_same_birth_status",
                        "method": "Profet-stage birth-status emigration risk",
                    })

    return (
        domestic_in_levels,
        domestic_in_distribution,
        out_risks,
        international_in,
    )


def constrained_birth_status_net_allocation(
    migration_status, population_status, geos=None, window=10
):
    """Allocate incumbent net10 migration across birth-status states.

    Positive net migration uses each status share of gross in-migration in
    the sex-age cell; negative net migration uses the corresponding gross
    out-migration share. If a cell has no migration events, the status share
    of population exposure over the same window is used as a deterministic
    fallback. The aggregate net-migration cell total is not estimated here.
    """
    statuses = ("sweden_born", "foreign_born")
    profile_geos = list(geos or MUNICIPALITIES)
    yrs = list(window_years(window))
    rows_out = []
    for geo in profile_geos:
        for sex in ("K", "M"):
            for age in range(101):
                inflow = {}
                outflow = {}
                exposure = {}
                for status in statuses:
                    inflow[status] = sum(
                        migration_status.get(
                            (geo, y, sex, age, status, leg, "in"), 0.0
                        )
                        for y in yrs
                        for leg in ("county", "rest_sweden", "international")
                    )
                    outflow[status] = sum(
                        migration_status.get(
                            (geo, y, sex, age, status, leg, "out"), 0.0
                        )
                        for y in yrs
                        for leg in ("county", "rest_sweden", "international")
                    )
                    exposure[status] = sum(
                        population_status.get(
                            (geo, y, sex, age, status), 0.0
                        )
                        for y in yrs
                    )
                in_total = sum(inflow.values())
                out_total = sum(outflow.values())
                pop_total = sum(exposure.values())
                for status in statuses:
                    fallback = (
                        exposure[status] / pop_total
                        if pop_total > 0 else
                        (1.0 if status == "sweden_born" else 0.0)
                    )
                    positive_share = (
                        inflow[status] / in_total if in_total > 0 else fallback
                    )
                    negative_share = (
                        outflow[status] / out_total if out_total > 0 else fallback
                    )
                    rows_out.append({
                        "geo": geo,
                        "window": window,
                        "sex": sex,
                        "age": age,
                        "status": status,
                        "positiveShare": positive_share,
                        "negativeShare": negative_share,
                        "grossInEvents": inflow[status],
                        "grossOutEvents": outflow[status],
                        "populationExposure": exposure[status],
                        "fallbackUsedPositive": in_total <= 0,
                        "fallbackUsedNegative": out_total <= 0,
                        "method": "net10-preserving birth-status allocation",
                    })
    return rows_out


def birth_status_codes(file_key: str):
    info = manifest().get("files", {}).get(file_key, {})
    labels_map = (
        info.get("dimension_value_labels", {}).get("Fodelseregion", {})
    )
    result = {}
    for code, label in labels_map.items():
        text = str(label).strip().lower()
        if "utrikes" in text:
            result["foreign_born"] = code
        elif "inrikes" in text or "född i sverige" in text or "födda i sverige" in text:
            result["sweden_born"] = code
    return result


def load_population_birth_status(filename: str, file_key: str, allowed_geos=None):
    """Population stock by Swedish/foreign born, age and sex."""
    path = RAW / filename
    if not path.exists():
        return defaultdict(float)
    code_map = birth_status_codes(file_key)
    reverse = {v: k for k, v in code_map.items()}
    out = defaultdict(float)
    geos = _allowed_geographies(allowed_geos)
    for r in rows(path):
        geo = r.get("Region")
        sex = SEX_MAP.get(r.get("Kon", ""))
        age = age_value(r.get("Alder", ""))
        status = reverse.get(str(r.get("Fodelseregion", "")).strip())
        if geo not in geos or not sex or age is None or not status:
            continue
        for col, _, year in value_columns(r.keys()):
            out[(geo, year, sex, age, status)] += num(r[col])
    return out


def birth_status_diagnostic(pop_birth_status, year=2024):
    """Expose population composition without activating it in the engine."""
    result = []
    for geo in MUNICIPALITIES:
        for sex in ("K", "M"):
            for age in range(101):
                sw = pop_birth_status.get(
                    (geo, year, sex, age, "sweden_born"), 0.0
                )
                foreign = pop_birth_status.get(
                    (geo, year, sex, age, "foreign_born"), 0.0
                )
                total = sw + foreign
                result.append({
                    "geo": geo,
                    "year": year,
                    "sex": sex,
                    "age": age,
                    "swedenBorn": sw,
                    "foreignBorn": foreign,
                    "foreignBornShare": None if total <= 0 else foreign / total,
                    "status": "diagnostic_only_not_used_by_forecast_engine",
                })
    return result


def birth_status_population_rows(pop_birth_status, year, geos=None):
    """Population state rows by Swedish-/foreign-born for a base year."""
    allowed = set(geos or MUNICIPALITIES)
    result = []
    for geo in allowed:
        for status in ("sweden_born", "foreign_born"):
            for sex in ("K", "M"):
                for age in range(101):
                    result.append({
                        "geo": geo,
                        "year": year,
                        "status": status,
                        "sex": sex,
                        "age": age,
                        "value": pop_birth_status.get(
                            (geo, year, sex, age, status), 0.0
                        ),
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
    used to fit the 2/3/4/6/10-year profiles and is retained as a one-year
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
        "migration_pre2025.csv", "migration_birth_region_pre2025.csv",
        "births_pre2025.csv", "deaths_pre2025.csv",
        "population_birth_region_pre2025.csv"
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
        allowed_geos=set(MUNICIPALITIES) | {RIKET_CODE},
    )
    population_birth_status = load_population_birth_status(
        "population_birth_region_pre2025.csv",
        "population_birth_region_pre2025",
        allowed_geos=set(MUNICIPALITIES) | {RIKET_CODE},
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
    migration_component_inflow, migration_component_out_hazards = (
        migration_component_profiles(migration_legs_pre2025, birth_year_exposure)
    )
    migration_component_config = json.loads(
        MIGRATION_COMPONENT_CONFIG.read_text(encoding="utf-8")
    )
    if migration_component_config.get("status") != "development_candidate_locked_before_external_component_results":
        raise RuntimeError("Unexpected migration component candidate status.")

    migration_recency_config = json.loads(
        MIGRATION_RECENCY_CANDIDATE_CONFIG.read_text(encoding="utf-8")
    )
    if migration_recency_config.get("status") != "development_candidate_locked_before_full_cohort_results":
        raise RuntimeError("Unexpected migration recency candidate status.")
    migration_recency_out_rows = migration_recency_out_hazards(
        migration_legs_pre2025, birth_year_exposure, migration_recency_config
    )

    scb_risk_config = json.loads(
        SCB_RISK_MIGRATION_CONFIG.read_text(encoding="utf-8")
    )
    if scb_risk_config.get("status") != "method_locked_from_published_scb_regional_method_before_validation":
        raise RuntimeError("Unexpected SCB risk migration candidate status.")
    (
        scb_risk_internal_in_levels,
        scb_risk_internal_in_distribution,
        scb_risk_out,
        scb_risk_international_in,
    ) = scb_risk_migration_profiles(
        migration_legs_pre2025, birth_year_exposure, scb_risk_config
    )

    future_fert, future_mort = national_future_profiles(
        "raps_national_detail_2024.csv",
        "raps_national_detail_2024",
        "raps_births_2024.csv",
    )
    (
        scb_national_immigration,
        scb_national_migration_exposure,
    ) = load_forecast_migration_context(
        "raps_national_detail_2024.csv",
        "raps_national_detail_2024",
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

    migration_age_smoothing = adaptive_migration_age_smoothing(
        migration_legs_pre2025, scb_risk_config
    )

    model = {
        "meta": {
            "schemaVersion": "0.15.0",
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
                "Historical municipal urisk and gross inflow profiles are stored as migration-building inputs. "
                "A separate three-leg component-flow candidate is also generated with population-responsive "
                "out-migration hazards, while the published baseline still uses locally calibrated net migration."
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
            "defaultMigrationWindow": 10,
            "migrationComponentStatus": "development_candidate_not_production_default",
            "migrationComponentProductionDefault": False,
            "migrationComponentWindows": migration_component_config["legs"],
            "migrationRecencyCandidateStatus": "development_candidate_not_production_default",
            "migrationRecencyCandidate": migration_recency_config,
            "migrationComponentMethod": (
                "Three geographic legs with historical mean inflow and population-responsive "
                "outflow hazards. Selected leg hazards are summed per age/sex cell and converted "
                "once with 1-exp(-sum(hazard))."
            ),
            "scbRiskMigrationStatus": "development_candidate_not_production_default",
            "scbRiskMigrationProductionDefault": False,
            "scbRiskMigrationConfig": scb_risk_config,
            "scbRiskMigrationMethod": (
                "Domestic total in-migration risk x rest-of-Sweden population, distributed by "
                "municipality-specific 9-year age/sex profile; domestic out-migration and emigration "
                "risk x municipal population; immigration = municipality historical share of national "
                "immigration x municipality age/sex distribution."
            ),
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
        "migrationComponentInflow": migration_component_inflow,
        "migrationComponentOutHazards": migration_component_out_hazards,
        "migrationRecencyOutHazards": migration_recency_out_rows,
        "scbRiskDomesticInLevels": scb_risk_internal_in_levels,
        "scbRiskDomesticInDistribution": scb_risk_internal_in_distribution,
        "scbRiskOutMigration": scb_risk_out,
        "scbRiskInternationalInMigration": scb_risk_international_in,
        "scbRiskNationalMeanPopulation": [
            {"year": year, "sex": sex, "age": age, "value": value}
            for (year, sex, age), value in sorted(scb_national_migration_exposure.items())
            if year >= 2026
        ],
        "scbRiskNationalImmigration": [
            {"year": year, "value": value}
            for year, value in sorted(scb_national_immigration.items())
            if year >= 2026
        ],
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
            "migrationAgeSmoothing": migration_age_smoothing,
            "migrationAgeSmoothingCompact": compact_migration_smoothing_diagnostic(
                migration_age_smoothing
            ),
            "youngAdultMigration": young_adult_migration_diagnostics(inflow, outflow, netmig),
            "migrationLegs": migration_leg_diagnostics(
                migration_legs_pre2025, migration_legs_2025
            ),
            "migrationBirthStatus": {
                "status": "diagnostic_only",
                "source": "SCB population by Swedish/foreign born; not active in forecast engine",
                "population2024": birth_status_diagnostic(population_birth_status, 2024),
            },
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
    SMOOTHING_DIAGNOSTIC_JSON.parent.mkdir(parents=True, exist_ok=True)
    compact_smoothing = compact_migration_smoothing_diagnostic(
        migration_age_smoothing
    )
    SMOOTHING_DIAGNOSTIC_JSON.write_text(
        json.dumps(
            compact_smoothing,
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    SMOOTHING_DIAGNOSTIC_JS.write_text(
        "window.MIGRATION_SMOOTHING_DIAGNOSTIC = "
        + json.dumps(compact_smoothing, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )

    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")
    print(f"Wrote {SMOOTHING_DIAGNOSTIC_JSON.relative_to(ROOT)}")
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
