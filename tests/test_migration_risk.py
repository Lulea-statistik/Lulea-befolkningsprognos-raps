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


assert tuple(mod.MIGRATION_WINDOWS) == (2, 4, 6, 10, 19)

# Short-window profiles must use the most recent years without changing the
# denominator of other demographic components.
netmig = {}
for year, value in [(2023, 40.0), (2024, 60.0)]:
    netmig[("2580", year, "K", 19)] = value
profiles = mod.migration_profiles(netmig)
p2 = next(r for r in profiles if r["geo"] == "2580" and r["window"] == 2 and r["sex"] == "K" and r["age"] == 19)
assert abs(p2["value"] - 50.0) < 1e-12

student_in = {
    ("2580", 2023, "K", 19): 100.0,
    ("2580", 2024, "K", 19): 120.0,
    ("2580", 2023, "M", 20): 80.0,
    ("2580", 2024, "M", 20): 100.0,
}
student_out = {
    ("2580", 2023, "K", 19): 20.0,
    ("2580", 2024, "K", 19): 30.0,
    ("2580", 2023, "M", 20): 10.0,
    ("2580", 2024, "M", 20): 20.0,
}
student_net = {
    key: student_in.get(key, 0.0) - student_out.get(key, 0.0)
    for key in set(student_in) | set(student_out)
}
student_diag = mod.student_age_migration_diagnostics(
    student_in, student_out, student_net
)
assert student_diag["proxyOnly"] is True
student_2 = next(
    r for r in student_diag["summaries"]
    if r["group"] == "entry_19_20" and r["window"] == 2
)
assert abs(student_2["meanInflow"] - 200.0) < 1e-12
assert abs(student_2["meanOutflow"] - 40.0) < 1e-12
assert abs(student_2["meanNetMigration"] - 160.0) < 1e-12

print("OK: municipal urisk and gross in-migration profiles are valid and FA gross flows are excluded")
