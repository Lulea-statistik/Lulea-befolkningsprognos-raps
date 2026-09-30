#!/usr/bin/env python3
"""Generic SCB PxWebApi v2 discovery/metadata client for the Luleå rAps-like model.

The script deliberately discovers table IDs at runtime instead of hard-coding old
PxWeb paths. It currently stores table discovery and metadata; the next transform
step maps exact dimension value codes to model_data.json.
"""
from __future__ import annotations
import argparse, json, sys, time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = "https://statistikdatabasen.scb.se/api/v2"
DEFAULT_QUERIES = {
    "population_2025": "Folkmängden efter region civilstånd ålder och kön 2025",
    "mean_population_2025": "Medelfolkmängd efter födelseår region ålder kön 2025",
    "migration_2025": "Flyttningar efter region ålder och kön 2025",
    "births_2025": "Födda efter region moderns ålder barnets kön 2025",
    "fertility_forecast": "Fruktsamhetstal prognos födelseregion ålder",
    "mortality_forecast": "Dödstal prognos födelseregion kön ålder",
}

def get_json(path: str, params: dict | None = None):
    url = BASE + path
    if params:
        url += "?" + urlencode(params)
    req = Request(url, headers={"User-Agent":"lulea-raps-model/0.1"})
    with urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))

def discover(query: str, page_size: int = 20):
    return get_json("/tables", {"lang":"sv","query":query,"pageSize":page_size})

def metadata(table_id: str):
    return get_json(f"/tables/{table_id}/metadata", {"lang":"sv","defaultSelection":"false"})

def score_table(table: dict, query: str):
    label=(table.get("label") or "").lower(); q=query.lower()
    terms=[t for t in q.replace("–"," ").replace("-"," ").split() if len(t)>2]
    return sum(1 for t in terms if t in label)

def best_table(result: dict, query: str):
    tables=result.get("tables") or []
    if not tables: return None
    return sorted(tables,key=lambda t:(score_table(t,query),t.get("updated","")),reverse=True)[0]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--out", default="../data/scb_discovery.json")
    ap.add_argument("--query", action="append", help="Extra free-text query")
    args=ap.parse_args()
    queries=dict(DEFAULT_QUERIES)
    if args.query:
        for i,q in enumerate(args.query,1): queries[f"extra_{i}"]=q
    output={"api":BASE,"generated_by":"scb_v2_client.py","tables":{}}
    for key,q in queries.items():
        print(f"Discovering: {key}: {q}", file=sys.stderr)
        res=discover(q)
        best=best_table(res,q)
        item={"query":q,"matches":res.get("tables",[]),"selected":best}
        if best and best.get("id"):
            try: item["metadata"]=metadata(best["id"])
            except Exception as e: item["metadata_error"]=str(e)
        output["tables"][key]=item
        time.sleep(0.4)
    out=Path(args.out).resolve(); out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding="utf-8")
    print(out)

if __name__=="__main__": main()
