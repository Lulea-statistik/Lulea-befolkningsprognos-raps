#!/usr/bin/env python3
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_model_data as b
import scb_extract as extract

sources = json.loads(
    (ROOT / "data" / "scb_sources.json").read_text(encoding="utf-8")
)

assert b.HISTORICAL_BIRTH_YEAR_EXPOSURE_FILE == "mean_population_pre2025.csv"
assert b.HISTORICAL_EVENT_AGE_EXPOSURE_FILE == "mean_population_event_age_pre2025.csv"

assert sources["tables"]["mean_population_pre2025"]["id"] == "TAB2818"
assert sources["tables"]["mean_population_event_age_pre2025"]["id"] == "TAB2819"
assert sources["tables"]["mean_population_event_age_2025"]["id"] == "TAB6759"

assert "mean_population_pre2025" in extract.SPECS
assert "mean_population_event_age_pre2025" in extract.SPECS
assert extract.SPECS["mean_population_event_age_pre2025"]["include_riket"] is True

# Fertility and mortality must respond to their supplied exposure denominator.
births = {
    (b.RIKET_CODE, 2024, 30): 10.0,
    ("2580", 2024, 30): 5.0,
}
event_age_exposure = {
    (b.RIKET_CODE, 2024, "K", 30): 1000.0,
    ("2580", 2024, "K", 30): 400.0,
}
birth_year_exposure = {
    (b.RIKET_CODE, 2024, "K", 30): 800.0,
    ("2580", 2024, "K", 30): 500.0,
}

original_end = b.CALIBRATION_END
original_windows = b.WINDOWS
try:
    b.CALIBRATION_END = 2024
    b.WINDOWS = (1,)
    fert_event, _ = b.fertility_profiles(births, event_age_exposure)
    fert_birth_year, _ = b.fertility_profiles(births, birth_year_exposure)
finally:
    b.CALIBRATION_END = original_end
    b.WINDOWS = original_windows

f_event = next(r for r in fert_event if r["geo"] == "2580" and r["age"] == 30)
f_birth = next(r for r in fert_birth_year if r["geo"] == "2580" and r["age"] == 30)
assert abs(f_event["nationalRate"] - 0.01) < 1e-12
assert abs(f_birth["nationalRate"] - 0.0125) < 1e-12
assert f_event["nationalRate"] != f_birth["nationalRate"]

print("OK: stock and event exposure sources are separated by age convention")
