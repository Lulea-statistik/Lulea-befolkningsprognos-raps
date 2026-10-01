#!/usr/bin/env python3
import importlib.util
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_model_data", ROOT / "scripts" / "build_model_data.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

outflow = {}
exposure = {}
inflow = {}
for year in mod.window_years(6):
    outflow[("2580", year, "K", 30)] = 10.0
    exposure[("2580", year, "K", 30)] = 1000.0
    inflow[("2580", year, "K", 30)] = 12.0

urisk = mod.outmigration_risk_profiles(outflow, exposure)
row = next(r for r in urisk if r["geo"] == "2580" and r["window"] == 6 and r["sex"] == "K" and r["age"] == 30)
expected = 1.0 - math.exp(-60.0 / 6000.0)
assert abs(row["value"] - expected) < 1e-12
assert abs(row["annualMeanOutflow"] - 10.0) < 1e-12
assert all(r["geo"] != mod.FA_CODE for r in urisk)

gross_in = mod.gross_inmigration_profiles(inflow)
row_in = next(r for r in gross_in if r["geo"] == "2580" and r["window"] == 6 and r["sex"] == "K" and r["age"] == 30)
assert abs(row_in["value"] - 12.0) < 1e-12
assert all(r["geo"] != mod.FA_CODE for r in gross_in)

zero = next(r for r in urisk if r["geo"] == "2580" and r["window"] == 6 and r["sex"] == "M" and r["age"] == 30)
assert zero["value"] == 0.0

print("OK: municipal urisk and gross in-migration profiles are valid and FA gross flows are excluded")
