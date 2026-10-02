#!/usr/bin/env python3
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "consistency", ROOT / "scripts" / "build_scb_consistency_diagnostic.py"
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

fields = [
    "Region", "Kon", "Alder",
    "000004LH 2026", "000004LI 2026",
    "000004LJ 2026", "000004LK 2026",
]
rows = [
    {
        "Region": "25", "Kon": "1", "Alder": "30",
        "000004LH 2026": "70", "000004LI 2026": "70",
        "000004LJ 2026": "20", "000004LK 2026": "10",
    },
    {
        "Region": "2580", "Kon": "1", "Alder": "30",
        "000004LH 2026": "60", "000004LI 2026": "50",
        "000004LJ 2026": "12", "000004LK 2026": "6",
    },
    {
        "Region": "2582", "Kon": "1", "Alder": "30",
        "000004LH 2026": "40", "000004LI 2026": "50",
        "000004LJ 2026": "8", "000004LK 2026": "4",
    },
]
wanted = ["000004LH", "000004LI", "000004LJ", "000004LK"]
totals, years = mod.aggregate_wide_flows(
    rows, fields, {"25", "2580", "2582"}, wanted
)
assert years == [2026]
assert totals[("2580", "000004LH", 2026)] == 60
assert totals[("2582", "000004LH", 2026)] == 40
assert totals[("25", "000004LH", 2026)] == 70
assert (60 + 40 - 70) == (50 + 50 - 70)
assert (12 + 8) == 20
assert (6 + 4) == 10

print("OK: wide TAB698 consistency parser reads content-code/year columns")
