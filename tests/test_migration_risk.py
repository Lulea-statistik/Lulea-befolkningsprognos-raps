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


assert tuple(mod.MIGRATION_WINDOWS) == (2, 4, 6, 10)

# Short-window profiles must use the most recent years without changing the
# denominator of other demographic components.
netmig = {}
for year, value in [(2023, 40.0), (2024, 60.0)]:
    netmig[("2580", year, "K", 19)] = value
profiles = mod.migration_profiles(netmig)
p2 = next(r for r in profiles if r["geo"] == "2580" and r["window"] == 2 and r["sex"] == "K" and r["age"] == 19)
assert abs(p2["value"] - 50.0) < 1e-12

young_in = {
    ("2580", 2023, "K", 19): 100.0,
    ("2580", 2024, "K", 19): 120.0,
    ("2580", 2023, "M", 20): 80.0,
    ("2580", 2024, "M", 20): 100.0,
}
young_out = {
    ("2580", 2023, "K", 19): 20.0,
    ("2580", 2024, "K", 19): 30.0,
    ("2580", 2023, "M", 20): 10.0,
    ("2580", 2024, "M", 20): 20.0,
}
young_net = {
    key: young_in.get(key, 0.0) - young_out.get(key, 0.0)
    for key in set(young_in) | set(young_out)
}
young_diag = mod.young_adult_migration_diagnostics(
    young_in, young_out, young_net
)
young_2 = next(
    r for r in young_diag["summaries"]
    if r["group"] == "entry_19_20" and r["window"] == 2
)
assert abs(young_2["meanInflow"] - 200.0) < 1e-12
assert abs(young_2["meanOutflow"] - 40.0) < 1e-12
assert abs(young_2["meanNetMigration"] - 160.0) < 1e-12
assert any(r["group"] == "exit_24_25" for r in young_diag["summaries"])

# Three geographic legs are held separately and can use different windows.
leg_data = {}
for year in range(2017, 2025):
    leg_data[("2580", year, "K", 30, "county", "in")] = 100.0 + year - 2017
    leg_data[("2580", year, "K", 30, "county", "out")] = 80.0
    leg_data[("2580", year, "K", 30, "county", "net")] = 20.0 + year - 2017
    leg_data[("2580", year, "K", 30, "rest_sweden", "in")] = 200.0
    leg_data[("2580", year, "K", 30, "rest_sweden", "out")] = 190.0
    leg_data[("2580", year, "K", 30, "rest_sweden", "net")] = 10.0
    leg_data[("2580", year, "K", 30, "international", "in")] = 50.0
    leg_data[("2580", year, "K", 30, "international", "out")] = 30.0
    leg_data[("2580", year, "K", 30, "international", "net")] = 20.0

leg_diag = mod.migration_leg_diagnostics(leg_data)
assert set(leg_diag["labels"]) == {"county", "rest_sweden", "international"}
county_2 = next(
    r for r in leg_diag["summaries"]
    if r["geo"] == "2580" and r["leg"] == "county" and r["window"] == 2
)
assert abs(county_2["meanInflow"] - 106.5) < 1e-12
assert abs(county_2["meanOutflow"] - 80.0) < 1e-12
assert abs(county_2["meanNetMigration"] - 26.5) < 1e-12
assert all(r["window"] in (2,4,6,10) for r in leg_diag["windowBacktestLulea"])


raw_leg_path = ROOT / "data" / "raw" / "migration_birth_region_pre2025.csv"
if raw_leg_path.exists():
    raw_legs = mod.load_migration_legs(
        "migration_birth_region_pre2025.csv",
        mod.MIGRATION_LEG_CODES_PRE2025,
        allowed_geos={"2580"},
    )
    assert raw_legs
    for leg in ("county", "rest_sweden", "international"):
        inflow_2024 = mod._migration_leg_total(raw_legs, "2580", 2024, leg, "in")
        outflow_2024 = mod._migration_leg_total(raw_legs, "2580", 2024, leg, "out")
        net_2024 = mod._migration_leg_total(raw_legs, "2580", 2024, leg, "net")
        assert inflow_2024 > 0
        assert outflow_2024 >= 0
        assert abs((inflow_2024 - outflow_2024) - net_2024) < 1e-9

# Three-leg component inputs retain separate inflows and population-responsive
# outflow hazards for the locked candidate engine.
component_legs = {}
component_exposure = {}
for year in mod.window_years(10):
    component_exposure[("2580", year, "K", 30)] = 1000.0
    for leg, incoming, outgoing in (
        ("county", 20.0, 10.0),
        ("rest_sweden", 30.0, 20.0),
        ("international", 10.0, 5.0),
    ):
        component_legs[("2580", year, "K", 30, leg, "in")] = incoming
        component_legs[("2580", year, "K", 30, leg, "out")] = outgoing

component_in, component_out = mod.migration_component_profiles(
    component_legs, component_exposure
)
county_in_6 = next(
    r for r in component_in
    if r["geo"] == "2580" and r["leg"] == "county"
    and r["window"] == 6 and r["sex"] == "K" and r["age"] == 30
)
rest_out_4 = next(
    r for r in component_out
    if r["geo"] == "2580" and r["leg"] == "rest_sweden"
    and r["window"] == 4 and r["sex"] == "K" and r["age"] == 30
)
international_out_2 = next(
    r for r in component_out
    if r["geo"] == "2580" and r["leg"] == "international"
    and r["window"] == 2 and r["sex"] == "K" and r["age"] == 30
)
assert abs(county_in_6["value"] - 20.0) < 1e-12
assert abs(rest_out_4["value"] - 0.02) < 1e-12
assert abs(international_out_2["value"] - 0.005) < 1e-12
assert all(r["geo"] != mod.FA_CODE for r in component_in)
assert all(r["geo"] != mod.FA_CODE for r in component_out)

print("OK: municipal urisk, gross inflow and three-leg component migration inputs are valid")
