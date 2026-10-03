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


smooth = cfg["smoothingCandidate"]
assert smooth["status"] == "top5_locked_before_smoothing_results"
assert smooth["topK"] == 5
assert [x["code"] for x in smooth["selected"]] == [
    "0780","1490","2281","2380","1780"
]

print("OK: migration analogue pool, ranking rule and top-five smoothing pool are locked")
