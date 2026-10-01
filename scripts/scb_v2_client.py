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
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = "https://statistikdatabasen.scb.se/api/v2"

DEFAULT_QUERIES = {
    "population_pre2025": "Folkmängden efter region civilstånd ålder och kön 1968 2024",
    "population_2025": "Folkmängden efter region civilstånd ålder och kön 2025",
    "mean_population_pre2025": "Medelfolkmängd efter födelseår region ålder kön",
    "mean_population_2025": "Medelfolkmängd efter födelseår region ålder kön 2025",
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
}

def get_json(path: str, params: dict | None = None):
    url = BASE + path
    if params:
        url += "?" + urlencode(params)
    req = Request(url, headers={"User-Agent": "lulea-raps-model/0.2"})
    with urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

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
