#!/usr/bin/env python3
"""SCB PxWebApi v2 discovery/metadata client for the Luleå rAps-like model.

The script discovers current table IDs at runtime instead of hard-coding legacy
PxWeb paths. It stores candidate matches, the selected table, and metadata for
all sources needed by the first demographic model version.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from http.client import RemoteDisconnected
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = "https://statistikdatabasen.scb.se/api/v2"

DEFAULT_QUERIES = {
    "population_pre2025": "Folkmängden efter region civilstånd ålder och kön 1968 2024",
    "population_2025": "Folkmängden efter region civilstånd ålder och kön 2025",
    "mean_population_pre2025": "Medelfolkmängd efter födelseår region ålder kön",
    "mean_population_2025": "Medelfolkmängd efter födelseår region ålder kön 2025",
    "mean_population_event_age_pre2025": "Medelfolkmängd ålder under året region civilstånd ålder kön 2006 2024",
    "mean_population_event_age_2025": "Medelfolkmängd ålder under året region civilstånd ålder kön 2025",
    "migration_pre2025": "Flyttningar efter region ålder och kön 1997 2024",
    "migration_2025": "Flyttningar efter region ålder och kön 2025",
    "births_pre2025": "Födda efter region moderns ålder barnets kön 1968 2024",
    "births_2025": "Födda efter region moderns ålder barnets kön 2025",
    "deaths_pre2025": "Döda efter region ålder kön 1968 2024",
    "deaths_2025": "Döda efter region ålder kön 2025",
    "migration_birth_region_pre2025": "Flyttningar efter födelseregion region ålder kön 2002 2024",
    "migration_birth_region_2025": "Flyttningar efter födelseregion region ålder kön 2025",
    "fertility_forecast": "Fruktsamhetstal prognos födelseregion ålder 2026 2120",
    "mortality_forecast": "Dödstal prognos födelseregion kön ålder 2026 2120",
    "national_population_forecast": "Befolkningsframskrivning Sverige ålder kön 2026 2120",
    "regional_forecast_benchmark": "Befolkningsframskrivning region kommun ålder kön 2024 2070",
    "commuting_flows": "Sysselsatta bostadskommun arbetsställekommun kön 2020 2024",
    "employment_age_profile": "Sysselsatta region yrkesställning kön ålder födelseregion arbetsställets belägenhet 2020 2024",
    "household_size_by_tenure": "Antal personer per hushåll region boendeform 2012 2025",
    "household_size_by_apartment": "Antal hushåll genomsnittligt antal personer per hushåll region boendeform lägenhetstyp 2012 2025",
    "households_by_type": "Antal hushåll personer region hushållstyp antal barn 2011 2024",
    "household_totals": "Antal personer hushåll personer per hushåll region 2011 2025",
    "housing_stock": "Antal lägenheter region hustyp upplåtelseform 2013 2025",
    "education_population": "Befolkning 16 74 år region utbildningsnivå ålder kön 1985 2025",
}

def get_json(path: str, params: dict | None = None, max_attempts: int = 5):
    """Read PxWeb v2 JSON with retry/backoff for transient SCB failures.

    Permanent 4xx client errors are raised immediately, while temporary
    disconnects, rate limiting and common 5xx responses are retried.
    """
    url = BASE + path
    if params:
        url += "?" + urlencode(params)

    retry_http = {429, 500, 502, 503, 504}
    for attempt in range(1, max_attempts + 1):
        req = Request(
            url,
            headers={
                "User-Agent": "lulea-raps-model/0.6",
                "Connection": "close",
            },
        )
        try:
            with urlopen(req, timeout=60) as r:
                payload = json.loads(r.read().decode("utf-8"))
                time.sleep(0.15)
                return payload

        except HTTPError as e:
            if e.code not in retry_http or attempt >= max_attempts:
                raise
            retry_after = e.headers.get("Retry-After") if e.headers else None
            try:
                delay = float(retry_after) if retry_after else min(16.0, 2.0 ** (attempt - 1))
            except ValueError:
                delay = min(16.0, 2.0 ** (attempt - 1))
            print(
                f"  transient HTTP {e.code}; retry {attempt}/{max_attempts} in {delay:g}s",
                file=sys.stderr,
            )
            time.sleep(delay)

        except (RemoteDisconnected, URLError, TimeoutError, ConnectionResetError, OSError) as e:
            if attempt >= max_attempts:
                raise
            delay = min(16.0, 2.0 ** (attempt - 1))
            print(
                f"  transient {type(e).__name__}; retry {attempt}/{max_attempts} in {delay:g}s",
                file=sys.stderr,
            )
            time.sleep(delay)

    raise RuntimeError("SCB discovery retry loop ended unexpectedly")

def discover(query: str, page_size: int = 30):
    return get_json("/tables", {"lang": "sv", "query": query, "pageSize": page_size})

def metadata(table_id: str):
    return get_json(
        f"/tables/{table_id}/metadata",
        {"lang": "sv", "defaultSelection": "false"},
    )

def score_table(table: dict, query: str):
    label = (table.get("label") or "").lower()
    q = query.lower()
    terms = [
        t
        for t in q.replace("–", " ").replace("-", " ").split()
        if len(t) > 2
    ]
    return sum(1 for t in terms if t in label)

def best_table(result: dict, query: str):
    tables = result.get("tables") or []
    if not tables:
        return None
    return sorted(
        tables,
        key=lambda t: (score_table(t, query), t.get("updated", "")),
        reverse=True,
    )[0]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="../data/scb_discovery.json")
    ap.add_argument("--query", action="append", help="Extra free-text query")
    args = ap.parse_args()

    queries = dict(DEFAULT_QUERIES)
    if args.query:
        for i, q in enumerate(args.query, 1):
            queries[f"extra_{i}"] = q

    output = {
        "api": BASE,
        "generated_by": "scb_v2_client.py",
        "schema_version": "0.2.0",
        "tables": {},
    }

    for key, q in queries.items():
        print(f"Discovering: {key}: {q}", file=sys.stderr)
        res = discover(q)
        best = best_table(res, q)
        item = {
            "query": q,
            "matches": res.get("tables", []),
            "selected": best,
        }
        if best and best.get("id"):
            print(
                f"  Selected: {best.get('id')} | {best.get('label', '')}",
                file=sys.stderr,
            )
            try:
                item["metadata"] = metadata(best["id"])
            except Exception as e:
                item["metadata_error"] = str(e)
                print(f"  Metadata error: {e}", file=sys.stderr)
        else:
            print("  Selected: NONE", file=sys.stderr)

        output["tables"][key] = item
        time.sleep(0.35)

    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(out)

if __name__ == "__main__":
    main()
