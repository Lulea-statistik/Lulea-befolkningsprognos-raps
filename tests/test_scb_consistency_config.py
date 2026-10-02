#!/usr/bin/env python3
import json
from pathlib import Path
import importlib.util
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

spec = importlib.util.spec_from_file_location("scb_extract", ROOT / "scripts" / "scb_extract.py")
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)

cfg = json.loads((ROOT / "data" / "scb_consistency_geographies.json").read_text(encoding="utf-8"))
assert cfg["status"] == "support_geographies_locked_before_consistency_results"
assert cfg["county"]["code"] == "25"
expected = {
    "2505","2506","2510","2513","2514","2518","2521",
    "2523","2560","2580","2581","2582","2583","2584"
}
assert set(cfg["municipalities"]) == expected
assert set(extract.CONSISTENCY_GEOGRAPHIES) == expected | {"25"}

for key in (
    "population_pre2025",
    "mean_population_pre2025",
    "migration_pre2025",
    "births_pre2025",
    "deaths_pre2025",
    "migration_birth_region_pre2025",
    "regional_forecast_benchmark",
    "regional_flows_benchmark",
):
    assert extract.SPECS[key].get("include_consistency_geos") is True, key

holdouts = set(extract.REFERENCE_VALIDATION_MUNICIPALITIES)
support_only = expected - {"2514","2560","2580","2581","2582"}
assert not (support_only & holdouts), "Consistency support geographies must not become holdouts."

print("OK: Norrbotten consistency support geographies are fixed and separate from holdouts")
