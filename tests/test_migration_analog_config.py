#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
cfg = json.loads(
    (ROOT / "data" / "migration_analog_municipalities.json").read_text(encoding="utf-8")
)

assert cfg["status"] == "candidate_pool_locked_before_similarity_results"
assert cfg["target"]["code"] == "2580"
assert "2580" not in cfg["candidates"]
assert {"2480","1780","0780"}.issubset(cfg["candidates"])

features = cfg["index"]["features"]
assert abs(sum(float(x["weight"]) for x in features) - 1.0) < 1e-12
assert len(features) == 6
assert cfg["index"]["calibrationYears"] == list(range(2015, 2025))

print("OK: migration analogue pool and similarity weights are locked")
