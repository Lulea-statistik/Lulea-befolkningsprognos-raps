#!/usr/bin/env python3
"""Download selected SCB PxWebApi v2 tables for the Luleå rAps-like model.

The script reads data/scb_sources.json, inspects table metadata, and downloads
CSV extracts for the five municipalities. It deliberately stores raw extracts
before model transformation so source data and modelling assumptions remain
separate and auditable.
"""
from __future__ import annotations

import csv
import io
import json
import sys
import time
from http.client import RemoteDisconnected
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = "https://statistikdatabasen.scb.se/api/v2"
ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "data" / "scb_sources.json"
OUT = ROOT / "data" / "raw"

MUNICIPALITIES = ["2580", "2582", "2581", "2560", "2514"]
RIKET = "00"
MODEL_AGES = [str(i) for i in range(100)]
TOP_AGE_CODES = ["100+", "100+1"]
FERTILITY_AGES = [str(i) for i in range(15, 49)] + ["49+"]
SEXES = ["1", "2"]

def decode_response(raw: bytes, declared_charset: str | None = None) -> tuple[str, str]:
    """Decode SCB responses robustly.

    SCB metadata is normally UTF-8, while CSV downloads may be returned in a
    legacy Windows/Latin encoding. Respect an explicit HTTP charset first and
    then fall back through known encodings without replacing characters.
    """
    candidates = []
    if declared_charset:
        candidates.append(declared_charset)
    candidates.extend(["utf-8-sig", "utf-8", "cp1252", "iso-8859-1"])

    seen = set()
    for enc in candidates:
        if not enc or enc.lower() in seen:
            continue
        seen.add(enc.lower())
        try:
            return raw.decode(enc), enc
        except (UnicodeDecodeError, LookupError):
            pass
    raise UnicodeDecodeError("unknown", raw, 0, min(1, len(raw)), "No supported encoding")

def request_text(url: str, max_attempts: int = 5) -> str:
    """GET an SCB resource with retry/backoff for transient network failures.

    Permanent client errors such as 400/404 are raised immediately. Temporary
    connection resets, timeouts, 429 and common 5xx responses are retried so a
    long multi-table workflow is not lost because SCB closes one connection.
    """
    retry_http = {429, 500, 502, 503, 504}

    for attempt in range(1, max_attempts + 1):
        req = Request(
            url,
            headers={
                "User-Agent": "lulea-raps-model/0.5",
                "Connection": "close",
            },
        )
        try:
            with urlopen(req, timeout=120) as r:
                raw = r.read()
                declared = r.headers.get_content_charset()
                text, used = decode_response(raw, declared)
                if used.lower() not in ("utf-8", "utf-8-sig"):
                    print(f"    decoded response as {used}", file=sys.stderr)
                # Small courtesy pause also reduces burst pressure on PxWeb.
                time.sleep(0.15)
                return text

        except HTTPError as e:
            if e.code not in retry_http or attempt >= max_attempts:
                raise
            retry_after = e.headers.get("Retry-After") if e.headers else None
            try:
                delay = float(retry_after) if retry_after else min(16.0, 2.0 ** (attempt - 1))
            except ValueError:
                delay = min(16.0, 2.0 ** (attempt - 1))
            print(
                f"    transient HTTP {e.code}; retry {attempt}/{max_attempts} in {delay:g}s",
                file=sys.stderr,
            )
            time.sleep(delay)

        except (RemoteDisconnected, URLError, TimeoutError, ConnectionResetError, OSError) as e:
            if attempt >= max_attempts:
                raise
            delay = min(16.0, 2.0 ** (attempt - 1))
            print(
                f"    transient {type(e).__name__}; retry {attempt}/{max_attempts} in {delay:g}s",
                file=sys.stderr,
            )
            time.sleep(delay)

    raise RuntimeError("SCB request retry loop ended unexpectedly")

def request_json(url: str):
    return json.loads(request_text(url))

def metadata(table_id: str):
    return request_json(f"{BASE}/tables/{table_id}/metadata?lang=sv&defaultSelection=false")

def labels(dim: dict) -> dict[str, str]:
    return (dim.get("category") or {}).get("label") or {}

def values(dim: dict) -> list[str]:
    idx = (dim.get("category") or {}).get("index") or {}
    if isinstance(idx, dict):
        return list(idx.keys())
    return []

def choose_content_codes(md: dict, wanted_terms: list[str] | None = None) -> list[str]:
    dim = (md.get("dimension") or {}).get("ContentsCode")
    if not dim:
        return []
    labs = labels(dim)
    if not wanted_terms:
        return list(labs.keys())
    selected = []
    for code, label in labs.items():
        ll = label.lower()
        if any(term.lower() in ll for term in wanted_terms):
            selected.append(code)
    return selected or list(labs.keys())

def choose_years(md: dict, start: int | None, end: int | None) -> list[str]:
    dim = (md.get("dimension") or {}).get("Tid")
    years = values(dim or {})
    out = []
    for y in years:
        try:
            iy = int(y)
        except ValueError:
            continue
        if start is not None and iy < start:
            continue
        if end is not None and iy > end:
            continue
        out.append(y)
    return out

def total_code(dim: dict) -> str | None:
    labs = labels(dim)
    for code, label in labs.items():
        ll = str(label).strip().lower()
        if ll in {"totalt", "total", "båda könen", "samtliga"} or "totalt" in ll or "båda kön" in ll:
            return code
    return None

def build_selection(md: dict, spec: dict) -> dict[str, list[str]]:
    dims = md.get("dimension") or {}
    sel: dict[str, list[str]] = {}
    for dim_id, dim in dims.items():
        vals = values(dim)
        dim_label = str(dim.get("label") or "").strip().lower()

        if spec.get("commuting") and "bostadskommun" in dim_label:
            # Keep all residence municipalities so the dashboard can separate
            # the five FA municipalities from commuters residing outside FA.
            sel[dim_id] = vals
        elif spec.get("commuting") and ("arbetsställekommun" in dim_label or "arbetsstallekommun" in dim_label):
            sel[dim_id] = [x for x in MUNICIPALITIES if x in vals]
        elif dim_id == "Region":
            wanted = list(MUNICIPALITIES)
            if spec.get("include_riket"):
                wanted.append(RIKET)
            sel[dim_id] = [x for x in wanted if x in vals]
        elif dim_id in ("Alder", "AlderModer"):
            if spec.get("all_age_groups") and dim_id == "Alder":
                sel[dim_id] = vals
            elif dim_id == "AlderModer":
                if spec.get("all_maternal_ages"):
                    sel[dim_id] = vals
                else:
                    # Only mutually exclusive one-year maternal ages. 2025 CKM
                    # tables also expose overlapping 5-/10-year groups and totals.
                    sel[dim_id] = [x for x in FERTILITY_AGES if x in vals]
            else:
                if spec.get("all_ages"):
                    sel[dim_id] = vals
                else:
                    sel[dim_id] = [x for x in MODEL_AGES if x in vals]
                    # Historical tables use 100+, while CKM tables use 100+1 for
                    # the one-year age classification.
                    for top in TOP_AGE_CODES:
                        if top in vals:
                            sel[dim_id].append(top)
                            break
        elif dim_id == "Kon" or dim_label == "kön":
            if spec.get("commuting"):
                tc = total_code(dim)
                sel[dim_id] = [tc] if tc in vals else vals[:1]
            else:
                sel[dim_id] = [x for x in SEXES if x in vals]
        elif dim_id == "Civilstand":
            # SC = total, all marital statuses. Selecting SC plus its
            # components would duplicate the population.
            sel[dim_id] = ["SC"] if "SC" in vals else vals
        elif spec.get("employment_age_profile") and dim_label in ("yrkesställning", "yrkesstallning", "födelseregion", "fodelseregion"):
            tc = total_code(dim)
            sel[dim_id] = [tc] if tc in vals else vals[:1]
        elif dim_id == "Fodelseregion":
            if spec.get("all_birth_regions"):
                sel[dim_id] = vals
            elif "samt" in vals:
                sel[dim_id] = ["samt"]
            else:
                sel[dim_id] = vals
        elif dim_id == "InrikesUtrikes":
            # TAB6008: 13=inrikes född, 23=utrikes född, 83=totalt.
            # Use only total to avoid double-counting.
            sel[dim_id] = ["83"] if "83" in vals else vals
        elif dim_id == "ContentsCode":
            sel[dim_id] = choose_content_codes(md, spec.get("content_terms"))
        elif dim_id == "Tid" or dim_label == "år":
            if dim_id == "Tid":
                sel[dim_id] = choose_years(md, spec.get("start"), spec.get("end"))
            else:
                out = []
                for y in vals:
                    try:
                        iy = int(y)
                    except ValueError:
                        continue
                    if spec.get("start") is not None and iy < spec["start"]:
                        continue
                    if spec.get("end") is not None and iy > spec["end"]:
                        continue
                    out.append(y)
                sel[dim_id] = out
        else:
            sel[dim_id] = vals
    return {k:v for k,v in sel.items() if v}

def encode_params(selection: dict[str, list[str]]) -> str:
    # PxWebApi v2 GET syntax is:
    # valueCodes[Variable]=code1,code2,code3
    # Parameter name is case-sensitive in SCB's implementation.
    pairs: list[tuple[str, str]] = [("lang", "sv"), ("outputFormat", "csv")]
    for dim, vals in selection.items():
        pairs.append((f"valueCodes[{dim}]", ",".join(vals)))
    return urlencode(pairs)

def cell_count(selection: dict[str, list[str]]) -> int:
    total = 1
    for vals in selection.values():
        total *= max(1, len(vals))
    return total

def split_selection(
    selection: dict[str, list[str]],
    max_cells: int = 100000,
    max_query_chars: int = 3500,
    max_values_per_dimension: int = 80,
):
    """Split requests by both cell count and URL/query length.

    PxWebApi v2 uses GET parameters for value selections. A request can have
    relatively few cells but still exceed practical URL limits when a
    dimension contains hundreds of value codes (for example all Swedish
    residence municipalities in TAB1830).

    Splitting is generic: prefer Tid for cell-heavy requests, otherwise split
    the dimension contributing the longest encoded value list. The CSV merger
    outer-joins chunks on dimension columns, so chunks may differ by year or by
    another selected dimension.
    """
    encoded_len = len(encode_params(selection))
    cells = cell_count(selection)

    # A single dimension with hundreds of selected values can produce a GET
    # request that is rejected by a web server/proxy even when the number of
    # returned cells is modest. Split such dimensions proactively.
    oversized_dims = [
        (dim, vals)
        for dim, vals in selection.items()
        if len(vals) > max_values_per_dimension and dim != "ContentsCode"
    ]
    if oversized_dims:
        dim, vals = max(oversized_dims, key=lambda item: len(item[1]))
        batches = []
        for i in range(0, len(vals), max_values_per_dimension):
            part = {k: list(v) for k, v in selection.items()}
            part[dim] = list(vals[i:i + max_values_per_dimension])
            batches.extend(
                split_selection(
                    part,
                    max_cells,
                    max_query_chars,
                    max_values_per_dimension,
                )
            )
        return batches

    if cells <= max_cells and encoded_len <= max_query_chars:
        return [selection]

    # If the query string itself is too long, split the dimension whose encoded
    # list contributes most. Avoid ContentsCode where possible.
    if encoded_len > max_query_chars:
        candidates = [
            (dim, vals)
            for dim, vals in selection.items()
            if len(vals) > 1 and dim != "ContentsCode"
        ]
        if not candidates:
            raise RuntimeError(
                f"Selection URL is too long ({encoded_len:,} chars) and cannot be split."
            )
        dim, vals = max(
            candidates,
            key=lambda item: sum(len(str(v)) + 1 for v in item[1]),
        )
        mid = max(1, len(vals) // 2)
        batches = []
        for chunk in (vals[:mid], vals[mid:]):
            if not chunk:
                continue
            part = {k: list(v) for k, v in selection.items()}
            part[dim] = list(chunk)
            batches.extend(split_selection(part, max_cells, max_query_chars, max_values_per_dimension))
        return batches

    # Cell-heavy requests are most naturally split by time because PxWeb CSV is
    # wide by year. If time cannot be split, fall back to the largest dimension.
    years = selection.get("Tid") or []
    if len(years) > 1:
        cells_per_year = max(1, cells // len(years))
        years_per_batch = max(1, max_cells // cells_per_year)
        batches = []
        for i in range(0, len(years), years_per_batch):
            part = {k: list(v) for k, v in selection.items()}
            part["Tid"] = years[i:i + years_per_batch]
            batches.extend(split_selection(part, max_cells, max_query_chars, max_values_per_dimension))
        return batches

    candidates = [
        (dim, vals)
        for dim, vals in selection.items()
        if len(vals) > 1 and dim != "ContentsCode"
    ]
    if not candidates:
        raise RuntimeError(
            f"Selection has {cells:,} cells and no splittable dimension."
        )
    dim, vals = max(candidates, key=lambda item: len(item[1]))
    mid = max(1, len(vals) // 2)
    batches = []
    for chunk in (vals[:mid], vals[mid:]):
        if not chunk:
            continue
        part = {k: list(v) for k, v in selection.items()}
        part[dim] = list(chunk)
        batches.extend(split_selection(part, max_cells, max_query_chars, max_values_per_dimension))
    return batches

def _csv_dialect(text: str):
    sample = text[:10000]
    try:
        return csv.Sniffer().sniff(sample, delimiters=";,\t,")
    except csv.Error:
        return csv.excel

def merge_wide_csv_chunks(chunks: list[tuple[str, dict[str, list[str]]]]) -> str:
    """Merge PxWeb CSV batches split by year or by another dimension.

    PxWeb's CSV output is wide by year. Dimension-split chunks have identical
    value columns but different rows; year-split chunks have different value
    columns. The same outer-join by dimension columns handles both cases.
    """
    if not chunks:
        return ""
    if len(chunks) == 1:
        return chunks[0][0]

    parsed = []
    all_selected_years = {
        y for _, part in chunks for y in (part.get("Tid") or [])
    }

    for text, part in chunks:
        dialect = _csv_dialect(text)
        reader = csv.DictReader(io.StringIO(text), dialect=dialect)
        fields = reader.fieldnames or []
        if not fields:
            raise RuntimeError("SCB CSV response has no header.")
        rows = list(reader)
        selected_years = set(part.get("Tid") or [])
        # PxWeb CSV may name value columns either as "2024" or as
        # "<ContentsCode> 2024", e.g. "BE0101AU 2024".
        value_fields = [
            h for h in fields
            if any(h == y or h.endswith(" " + y) for y in selected_years)
        ]
        if not value_fields:
            raise RuntimeError(
                f"Could not identify value/year columns in SCB CSV header: {fields!r}"
            )
        dim_fields = [h for h in fields if h not in value_fields]
        parsed.append((fields, dim_fields, value_fields, rows, dialect.delimiter))

    base_dims = parsed[0][1]
    for _, dims, _, _, _ in parsed[1:]:
        if dims != base_dims:
            raise RuntimeError(
                "SCB CSV dimension columns differ between request batches: "
                f"{base_dims!r} vs {dims!r}"
            )

    year_order = []
    for _, _, years, _, _ in parsed:
        for y in years:
            if y not in year_order:
                year_order.append(y)

    merged_rows: dict[tuple[str, ...], dict[str, str]] = {}
    row_order: list[tuple[str, ...]] = []
    for _, dims, years, rows, _ in parsed:
        for row in rows:
            k = tuple(row.get(d, "") for d in dims)
            if k not in merged_rows:
                merged_rows[k] = {d: row.get(d, "") for d in dims}
                row_order.append(k)
            for y in years:
                merged_rows[k][y] = row.get(y, "")

    out = io.StringIO()
    delimiter = parsed[0][4]
    fields = base_dims + year_order
    writer = csv.DictWriter(out, fieldnames=fields, delimiter=delimiter, lineterminator="\n")
    writer.writeheader()
    for k in row_order:
        writer.writerow(merged_rows[k])
    return out.getvalue()

def download_csv(table_id: str, selection: dict[str, list[str]]) -> str:
    chunks: list[tuple[str, dict[str, list[str]]]] = []
    for batch_no, part in enumerate(split_selection(selection), 1):
        url = f"{BASE}/tables/{table_id}/data?" + encode_params(part)
        print(
            f"    request {batch_no}: {cell_count(part):,} cells",
            file=sys.stderr,
        )
        try:
            chunks.append((request_text(url), part))
        except Exception:
            print(f"    failed URL: {url}", file=sys.stderr)
            raise
    return merge_wide_csv_chunks(chunks)

SPECS = {
    "population_pre2025": {"start":2006,"end":2024,"content_terms":["Folkmängd"]},
    "population_2025": {"start":2025,"end":2025,"content_terms":["Folkmängd"]},
    "mean_population_pre2025": {"start":2006,"end":2024,"include_riket":True},
    "mean_population_2025": {"start":2025,"end":2025},
    "migration_pre2025": {"start":2006,"end":2024},
    "migration_2025": {"start":2025,"end":2025},
    "births_pre2025": {"start":2006,"end":2024,"include_riket":True},
    "births_2025": {"start":2025,"end":2025},
    "deaths_pre2025": {"start":2006,"end":2024,"include_riket":True},
    "deaths_2025": {"start":2025,"end":2025},
    "migration_birth_region_pre2025": {"start":2006,"end":2024,"all_birth_regions":True},
    "migration_birth_region_2025": {"start":2025,"end":2025,"all_birth_regions":True},
    "raps_fertility_forecast": {"start":2024,"end":2050,"all_birth_regions":True},
    "raps_mortality_forecast": {"start":2024,"end":2050,"all_birth_regions":True},
    "raps_national_detail_2024": {"start":2024,"end":2050,"all_birth_regions":True,"all_ages":True},
    "raps_births_2024": {"start":2024,"end":2050,"all_birth_regions":True,"all_maternal_ages":True},
    "backtest_national_detail_2021": {"start":2021,"end":2024,"all_birth_regions":True,"all_ages":True},
    "backtest_births_2021": {"start":2021,"end":2024,"all_birth_regions":True,"all_maternal_ages":True},
    "regional_forecast_benchmark": {"start":2024,"end":2050},
    "regional_flows_benchmark": {"start":2024,"end":2050},
    "commuting_flows": {"start":2020,"end":2024,"commuting":True},
    "employment_age_profile": {
        "start":2022,"end":2024,
        "all_age_groups":True,
        "employment_age_profile":True,
        "content_terms":["arbetsställets belägenhet"]
    },
}

def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"schema_version":"0.1.0","files":{}}

    for key, spec in SPECS.items():
        table = cfg["tables"][key]
        table_id = table["id"]
        print(f"Downloading {key} from {table_id}", file=sys.stderr)
        md = metadata(table_id)
        selection = build_selection(md, spec)
        if not selection:
            raise RuntimeError(f"No selection built for {key} / {table_id}")
        csv_text = download_csv(table_id, selection)
        if not csv_text.strip():
            raise RuntimeError(f"Empty response for {key} / {table_id}")
        path = OUT / f"{key}.csv"
        path.write_text(csv_text, encoding="utf-8")
        # Basic validation: at least header + one data row.
        rows = list(csv.reader(io.StringIO(csv_text)))
        if len(rows) < 2:
            raise RuntimeError(f"No data rows for {key} / {table_id}")
        manifest["files"][key] = {
            "table_id": table_id,
            "path": str(path.relative_to(ROOT)),
            "rows_including_header": len(rows),
            "selection": selection,
            "content_labels": labels((md.get("dimension") or {}).get("ContentsCode") or {}),
            "dimension_labels": {k: str(v.get("label") or "") for k, v in (md.get("dimension") or {}).items()},
        }
        print(f"  {len(rows)-1} rows -> {path.relative_to(ROOT)}", file=sys.stderr)
        time.sleep(0.4)

    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(OUT / "manifest.json")

if __name__ == "__main__":
    main()
