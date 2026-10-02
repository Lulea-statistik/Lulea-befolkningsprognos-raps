#!/usr/bin/env python3
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
holdout=json.loads(
    (ROOT/"data"/"component_flow_holdout_municipalities.json").read_text(encoding="utf-8")
)
refs=json.loads(
    (ROOT/"data"/"reference_fa_regions.json").read_text(encoding="utf-8")
)

assert holdout["status"]=="locked_before_component_flow_holdout_results"
assert holdout["lockedAfterRun"]==39
codes=set(holdout["municipalities"])
assert codes=={"2480","2482","2380","1780","0780"}
assert len(codes)==5

prior=set()
for region in refs["regions"].values():
    prior.update(region["members"])
lulea_fa={"2580","2582","2581","2560","2514"}

assert not (codes & prior), "New holdouts must not overlap consumed external references."
assert not (codes & lulea_fa), "New holdouts must not overlap Lulea FA members."

rule=holdout["productionDecisionRule"]
assert rule["primaryHorizon"]==1
assert rule["secondaryHorizon"]==2
assert "component_flow <= net_10y" in rule["pooledN1NetMigrationMAE"]

print("OK: component-flow holdout municipalities and pre-declared gate are locked")
