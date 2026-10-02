#!/usr/bin/env python3
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import scb_extract as extract
import build_reference_fa_backtest as refbuild

cfg = json.loads(
    (ROOT / "data" / "reference_fa_regions.json").read_text(encoding="utf-8")
)

assert cfg["scheme"] == "FA15"
assert tuple(refbuild.MIGRATION_WINDOWS) == (2, 4, 6, 10)
regions = cfg["regions"]

expected = {
    "FA16_TRH": {
        "1427","1430","1439","1444","1461","1484","1485","1487","1488"
    },
    "FA36_GAV": {"0319","2101","2104","2180","2181"},
    "FA42_SUN": {"2260","2262","2280","2281"},
}
for code, members in expected.items():
    assert code in regions
    assert set(regions[code]["members"]) == members

all_expected = set().union(*expected.values())
assert set(extract.REFERENCE_VALIDATION_MUNICIPALITIES) == all_expected

for key in (
    "population_pre2025",
    "mean_population_pre2025",
    "mean_population_event_age_pre2025",
    "migration_pre2025",
    "births_pre2025",
    "deaths_pre2025",
):
    assert extract.SPECS[key].get("include_reference_geos") is True

# Reference areas are fixed before looking at their scores.
assert regions["FA16_TRH"]["fa15Number"] == 16
assert regions["FA36_GAV"]["fa15Number"] == 36
assert regions["FA42_SUN"]["fa15Number"] == 42


# build_region_origin mutates build_model_data globals temporarily. Verify that
# both demographic and migration window state are restored even if the build
# aborts before writing any work files.
original_municipalities = refbuild.b.MUNICIPALITIES
original_fa_code = refbuild.b.FA_CODE
original_end = refbuild.b.CALIBRATION_END
original_windows = refbuild.b.WINDOWS
original_migration_windows = refbuild.b.MIGRATION_WINDOWS
original_fertility_profiles = refbuild.b.fertility_profiles

def fail_fertility(*args, **kwargs):
    raise RuntimeError("intentional state-restore test")

refbuild.b.fertility_profiles = fail_fertility
try:
    try:
        refbuild.build_region_origin(
            "TEST_FA",
            {"name": "Test", "members": {"2580": "Luleå"}},
            2021,
            {"detail_key": "unused", "births_key": "unused"},
            {
                "population": {},
                "birth_year_exposure": {},
                "event_age_exposure": {},
                "deaths": {},
                "births": {},
                "netmig": {},
            },
        )
        raise AssertionError("Expected intentional failure")
    except RuntimeError as exc:
        assert "intentional state-restore test" in str(exc)
finally:
    refbuild.b.fertility_profiles = original_fertility_profiles

assert refbuild.b.MUNICIPALITIES is original_municipalities
assert refbuild.b.FA_CODE == original_fa_code
assert refbuild.b.CALIBRATION_END == original_end
assert refbuild.b.WINDOWS == original_windows
assert refbuild.b.MIGRATION_WINDOWS == original_migration_windows


migration_cfg = json.loads(
    (ROOT / "data" / "migration_component_windows.json").read_text(encoding="utf-8")
)
assert migration_cfg["status"] == "development_candidate_locked_before_external_component_results"
assert migration_cfg["legs"]["county"]["inflowWindow"] == 6
assert migration_cfg["legs"]["county"]["outflowWindow"] == 6
assert migration_cfg["legs"]["rest_sweden"]["inflowWindow"] == 10
assert migration_cfg["legs"]["rest_sweden"]["outflowWindow"] == 4
assert migration_cfg["legs"]["international"]["inflowWindow"] == 10
assert migration_cfg["legs"]["international"]["outflowWindow"] == 2
assert extract.SPECS["migration_birth_region_pre2025"].get("include_reference_geos") is True

print("OK: FA15 reference regions and SCB extraction scope are fixed and valid")
