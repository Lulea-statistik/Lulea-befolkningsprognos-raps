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

print("OK: rolling-origin SCB vintages and extraction windows are consistent")
