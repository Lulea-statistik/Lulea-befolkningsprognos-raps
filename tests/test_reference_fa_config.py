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

print("OK: FA15 reference regions and SCB extraction scope are fixed and valid")
