#!/usr/bin/env python3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import scb_extract as s

selection = {
    "Kon": ["1+2"],
    "Bostadskommun": [f"{i:04d}" for i in range(300)],
    "Arbetsstallekommun": ["2580", "2582", "2581", "2560", "2514"],
    "ContentsCode": ["000000QT"],
    "Tid": ["2020", "2021", "2022", "2023", "2024"],
}

parts = s.split_selection(selection, max_cells=100000, max_query_chars=5500)
if len(parts) <= 1:
    raise AssertionError("Long municipality selection was not split.")

for part in parts:
    qlen = len(s.encode_params(part))
    if qlen > 5500:
        raise AssertionError(f"Split query is still too long: {qlen}")
    if len(part["Bostadskommun"]) > 80:
        raise AssertionError(
            f"Too many municipality values remain in one request: {len(part['Bostadskommun'])}"
        )

original = set(selection["Bostadskommun"])
recombined = []
for part in parts:
    recombined.extend(part["Bostadskommun"])

if set(recombined) != original:
    raise AssertionError("Municipality values were lost or changed while splitting.")
if len(recombined) != len(original):
    raise AssertionError("Municipality values were duplicated while splitting.")

for key in ("national_forecast_detail","national_forecast_births"):
    if key not in s.SPECS:
        raise AssertionError(f"Missing latest fertility sensitivity input: {key}")
    if s.SPECS[key].get("start") != 2026:
        raise AssertionError(f"{key} must start at the 2026 forecast vintage")
    if not s.SPECS[key].get("all_birth_regions"):
        raise AssertionError(f"{key} must include all birth regions")

print(f"OK: long PxWeb query split into {len(parts)} URL-safe batches")
