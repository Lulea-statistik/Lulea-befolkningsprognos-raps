#!/usr/bin/env python3
from datetime import date
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from historical_vintage_gate import vintage_eligible, latest_eligible_vintage

assert not vintage_eligible(2022, 2022)
assert not vintage_eligible(2023, 2023)
assert not vintage_eligible(2024, 2024)
assert vintage_eligible(2023, 2022)
assert vintage_eligible(2024, 2023)
assert latest_eligible_vintage(2022) == 2021
assert latest_eligible_vintage(2023) == 2022
assert latest_eligible_vintage(2024) == 2023
assert not vintage_eligible(2025, 2025)
assert not vintage_eligible(2022, 2022, date(2022, 12, 31))
print("Historical SCB vintage cutoff checks passed")
