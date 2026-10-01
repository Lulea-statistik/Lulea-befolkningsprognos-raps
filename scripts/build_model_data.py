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
SEX_MAP = {"1": "M", "2": "K", "M": "M", "K": "K"}

# Same concepts in the pre-CKM and 2025 CKM tables.
IN_MIG_CODES = {"BE0101AU", "0000086B"}
OUT_MIG_CODES = {"BE0101AV", "0000086F"}
NET_MIG_CODES = {"BE0101AZ", "00000868"}

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

def load_wide_age_sex(filename: str, allowed_codes=None):
    path = RAW / filename
    out = defaultdict(float)
    for r in rows(path):
        age = age_value(r.get("Alder", ""))
        sex = SEX_MAP.get(r.get("Kon", ""))
        geo = r.get("Region")
        if age is None or not sex or geo not in set(MUNICIPALITIES) | {RIKET_CODE}:
            continue
        for col, code, year in value_columns(r.keys(), allowed_codes):
            out[(geo, year, sex, age)] += num(r[col])
    return out

def load_births(filename: str):
    path = RAW / filename
    out = defaultdict(float)
    for r in rows(path):
        age = age_value(r.get("AlderModer", ""))
        geo = r.get("Region")
        if age is None or geo not in set(MUNICIPALITIES) | {RIKET_CODE} or not (15 <= age <= 49):
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

def aggregate_fa_age_sex(source):
    out = defaultdict(float)
    for (geo, year, sex, age), value in source.items():
        out[(geo, year, sex, age)] += value
        if geo in MUNICIPALITIES:
            out[(FA_CODE, year, sex, age)] += value
    return out

def aggregate_fa_births(source):
    out = defaultdict(float)
    for (geo, year, age), value in source.items():
        out[(geo, year, age)] += value
        if geo in MUNICIPALITIES:
            out[(FA_CODE, year, age)] += value
    return out

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
    for window in WINDOWS:
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

def migration_profiles(netmig):
    result = []
    geos = list(MUNICIPALITIES) + [FA_CODE]
    for window in WINDOWS:
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
        "population_2025.csv", "mean_population_pre2025.csv",
        "migration_pre2025.csv", "births_pre2025.csv",
        "deaths_pre2025.csv"
    ]
    missing = [p for p in required if not (RAW / p).exists()]
    if missing:
        raise SystemExit("Missing raw SCB files: " + ", ".join(missing))

    base = add_fa_population(load_population_2025())
    exposure = aggregate_fa_age_sex(load_wide_age_sex("mean_population_pre2025.csv"))
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

    deaths_2025 = {}
    netmig_2025 = {}
    if (RAW / "deaths_2025.csv").exists():
        deaths_2025 = aggregate_fa_age_sex(load_wide_age_sex("deaths_2025.csv"))
    if (RAW / "migration_2025.csv").exists():
        netmig_2025 = aggregate_fa_age_sex(
            load_wide_age_sex("migration_2025.csv", NET_MIG_CODES)
        )

    fertility_rates, fertility_factors = fertility_profiles(births, exposure)
    mortality_risks, mortality_factors = mortality_profiles(deaths, exposure)

    future_fert, future_mort = national_future_profiles(
        "raps_national_detail_2024.csv",
        "raps_national_detail_2024",
        "raps_births_2024.csv",
    )
    if future_fert and future_mort:
        fertility_rates, mortality_risks = extend_profiles_with_future(
            fertility_rates, mortality_risks, future_fert, future_mort, start_year=2026
        )
        future_profile_mode = "SCB 2024 annual national profiles × local relative shape"
    else:
        future_profile_mode = "Historical national profile held constant (fallback)"

    model = {
        "meta": {
            "schemaVersion": "0.6.1",
            "generatedBy": "scripts/build_model_data.py",
            "dataReady": True,
            "baseYear": 2025,
            "projectionAssumptionVersion": "scb2024-national-trend-local-ratio-v1",
            "methodBreakYear": 2025,
            "methodBreak": "SCB Cell Key Method (CKM)",
            "calibrationEndYear": CALIBRATION_END,
            "note": (
                "Fertility and mortality use annual SCB 2024 national forecast profiles "
                "multiplied by locally calibrated municipality/FA relative shapes. "
                "Small age cells fade toward the national age profile. Net migration "
                "remains locally calibrated in V1."
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
            "qutbMode": "identity",
            "endogenousInMigration": False,
            "endogenousOutMigration": False,
            "iflMode": "deferred",
            "sexRatioMaleAtBirth": 0.515,
            "sexRatioMaleAtBirthSource": "Raps technical specification: 0.515 boys / 0.485 girls",
            "observedMaleBirthShareFA2015_2024": male_birth_share,
            "relativeToNationalMethod": "General age-standardized municipality/FA ratio to Sweden",
            "futureNationalProfileMode": future_profile_mode,
        },
        "populationBase": [
            {"geo": geo, "year": 2025, "sex": sex, "age": age, "value": value}
            for (geo, sex, age), value in sorted(base.items())
        ],
        "fertilityRates": fertility_rates,
        "mortalityRisks": mortality_risks,
        "netMigration": migration_profiles(netmig),
        "diagnostics": {
            "ckm": ckm_diagnostics(base, deaths_2025, netmig_2025),
            "calibrationWindows": list(WINDOWS),
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
            f"migration={sum(1 for r in model['netMigration'] if r['window']==window)}"
        )

if __name__ == "__main__":
    main()
