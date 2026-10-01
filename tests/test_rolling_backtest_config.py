#!/usr/bin/env python3
import json
from pathlib import Path
import importlib.util
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

extract = load_module("scb_extract", ROOT / "scripts" / "scb_extract.py")
rolling = load_module("build_rolling_backtest", ROOT / "scripts" / "build_rolling_backtest.py")
sources = json.loads((ROOT / "data" / "scb_sources.json").read_text(encoding="utf-8"))

expected = {
    2018: ("TAB2895", "TAB2902"),
    2019: ("TAB5381", "TAB5331"),
    2020: ("TAB643", "TAB647"),
    2021: ("TAB5946", "TAB5948"),
}

assert tuple(rolling.WINDOWS) == (6, 10)
assert rolling.HORIZON_YEARS == 3
assert set(rolling.ORIGINS) == set(expected)

for origin, (detail_id, births_id) in expected.items():
    cfg = rolling.ORIGINS[origin]
    detail_key = cfg["detail_key"]
    births_key = cfg["births_key"]

    assert sources["tables"][detail_key]["id"] == detail_id
    assert sources["tables"][births_key]["id"] == births_id

    detail_spec = extract.SPECS[detail_key]
    births_spec = extract.SPECS[births_key]
    assert detail_spec["start"] == origin
    assert detail_spec["end"] == origin + rolling.HORIZON_YEARS
    assert detail_spec["all_birth_regions"] is True
    assert detail_spec["all_ages"] is True
    assert births_spec["start"] == origin
    assert births_spec["end"] == origin + rolling.HORIZON_YEARS
    assert births_spec["all_birth_regions"] is True
    assert births_spec["all_maternal_ages"] is True


forecast_births = {
    (2019, 30): 100.0,
    (2020, 30): 110.0,
    (2021, 30): 120.0,
}
actual_births = {
    (rolling.b.RIKET_CODE, 2019, 30): 90.0,
    (rolling.b.RIKET_CODE, 2020, 30): 100.0,
    (rolling.b.RIKET_CODE, 2021, 30): 130.0,
}
forecast_deaths = {
    (2019, "K", 80): 200.0,
    (2020, "K", 80): 210.0,
    (2021, "K", 80): 220.0,
}
actual_deaths = {
    (rolling.b.RIKET_CODE, 2019, "K", 80): 230.0,
    (rolling.b.RIKET_CODE, 2020, "K", 80): 240.0,
    (rolling.b.RIKET_CODE, 2021, "K", 80): 250.0,
}
diag = rolling.national_assumption_rows_from_counts(
    2018, 2021,
    forecast_births, forecast_deaths,
    actual_births, actual_deaths,
)
assert len(diag) == 3
assert diag[0]["birthsError"] == 10.0
assert diag[0]["deathsError"] == -30.0
assert diag[-1]["birthsError"] == -10.0
assert diag[-1]["deathsError"] == -30.0


national_only = rolling.national_only_mortality_rows(
    {
        (2019, "K", 80): 0.02,
        (2020, "M", 70): 0.01,
        (2022, "K", 90): 0.10,
    },
    start_year=2019,
    end_year=2020,
)
assert len(national_only) == len(rolling.b.MUNICIPALITIES) * len(rolling.WINDOWS) * 2
sample = next(
    row for row in national_only
    if row["geo"] == "2580"
    and row["window"] == 10
    and row["year"] == 2019
    and row["sex"] == "K"
    and row["age"] == 80
)
assert abs(sample["value"] - (1.0 - __import__("math").exp(-0.02))) < 1e-12
assert all(row["geo"] != rolling.b.FA_CODE for row in national_only)
assert all(row["year"] <= 2020 for row in national_only)

print("OK: rolling-origin SCB vintages and extraction windows are consistent")
