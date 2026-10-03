#!/usr/bin/env python3
"""Validate traceability and structural integrity of critical raw-source manifest entries."""
from __future__ import annotations

import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
MANIFEST=ROOT/"data"/"raw"/"manifest.json"
CFG=ROOT/"data"/"source_manifest_integrity_config.json"
OUT=ROOT/"data"/"backtests"/"source_manifest_integrity_validation.json"

PRE_CKM_KEYS={
    "population_pre2025",
    "mean_population_pre2025",
    "mean_population_event_age_pre2025",
    "births_pre2025",
    "deaths_pre2025",
    "migration_pre2025",
    "migration_birth_region_pre2025",
    "population_birth_region_pre2025",
}

def years_from_selection(entry):
    sel=(entry or {}).get("selection") or {}
    vals=sel.get("Tid") or []
    years=[]
    for v in vals:
        try:
            years.append(int(v))
        except (TypeError,ValueError):
            pass
    return years

def main():
    cfg=json.loads(CFG.read_text(encoding="utf-8"))
    manifest=json.loads(MANIFEST.read_text(encoding="utf-8"))
    files=manifest.get("files") or {}
    required=list(cfg["requiredSources"])

    missing=[k for k in required if k not in files]
    missing_table=[]
    missing_path=[]
    too_few_rows=[]
    empty_selection=[]
    bad_pre_ckm={}
    missing_2025=False

    for key in required:
        entry=files.get(key) or {}
        if not str(entry.get("table_id") or "").strip():
            missing_table.append(key)

        rel=str(entry.get("path") or "")
        p=(ROOT/rel) if rel else None
        if not p or not p.exists() or p.stat().st_size<=0:
            missing_path.append(key)

        rows=entry.get("rows_including_header")
        if rows is not None and int(rows)<2:
            too_few_rows.append(key)

        # Frozen reused files may lack a current selection only if explicitly
        # marked as legacy; production-critical entries should otherwise retain it.
        if not (entry.get("selection") or {}):
            empty_selection.append(key)

        if key in PRE_CKM_KEYS:
            yrs=years_from_selection(entry)
            if yrs and max(yrs)>2024:
                bad_pre_ckm[key]=yrs

    base2025=files.get("population_2025") or {}
    years2025=years_from_selection(base2025)
    missing_2025=2025 not in years2025

    checks={
        "allRequiredSourcesPresent":len(missing)==0,
        "allTableIdsPresent":len(missing_table)==0,
        "allRawFilesExistAndNonempty":len(missing_path)==0,
        "allManifestRowCountsValid":len(too_few_rows)==0,
        "allSelectionsRecorded":len(empty_selection)==0,
        "preCkmSourcesStopBy2024":len(bad_pre_ckm)==0,
        "population2025SelectionContains2025":not missing_2025,
    }
    all_passed=all(checks.values())
    out={
        "schemaVersion":"0.1.0",
        "status":"production_source_manifest_validated" if all_passed else "validation_failed",
        "allPassed":all_passed,
        "checks":checks,
        "requiredSourceCount":len(required),
        "missingSources":missing,
        "missingTableIds":missing_table,
        "missingOrEmptyFiles":missing_path,
        "invalidRowCounts":too_few_rows,
        "emptySelections":empty_selection,
        "preCkmYearViolations":bad_pre_ckm,
        "population2025Years":years2025,
        "note":"Source-traceability and raw-input structure gate; not a forecast-accuracy claim."
    }
    OUT.parent.mkdir(parents=True,exist_ok=True)
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(out,ensure_ascii=False,indent=2))
    if not all_passed:
        raise SystemExit("Source-manifest integrity validation failed.")

if __name__=="__main__":
    main()
