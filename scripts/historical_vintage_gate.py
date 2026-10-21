#!/usr/bin/env python3
"""Fail closed on future-published SCB vintages at a historical forecast origin."""
from datetime import date

# Dates refer to the specific detailed national projections needed by this model,
# not to potentially earlier regional forecast publications.
NATIONAL_DETAIL_RELEASES = {
    2021: date(2021, 4, 13),
    2022: date(2023, 4, 18),
    2023: date(2024, 4, 25),
    2024: date(2025, 4, 11),
}

def vintage_eligible(origin_year: int, vintage_year: int, cutoff: date | None = None) -> bool:
    """Return False if release is unavailable/unverified or after forecast cutoff."""
    if cutoff is None:
        cutoff = date(origin_year, 12, 31)
    published = NATIONAL_DETAIL_RELEASES.get(vintage_year)
    return published is not None and published <= cutoff

def latest_eligible_vintage(origin_year: int, cutoff: date | None = None) -> int | None:
    candidates = [v for v in NATIONAL_DETAIL_RELEASES if vintage_eligible(origin_year, v, cutoff)]
    return max(candidates) if candidates else None

if __name__ == "__main__":
    for year in range(2021, 2026):
        print(f"{year}: latest verified national detail vintage={latest_eligible_vintage(year)}")
