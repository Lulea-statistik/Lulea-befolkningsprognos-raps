#!/usr/bin/env python3
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "adjustment", ROOT / "scripts" / "build_scb_consistency_adjustment.py"
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

scaled = mod.scale_nonnegative({"a": 60, "b": 40}, 50)
assert abs(sum(scaled.values()) - 50) < 1e-9
assert abs(scaled["a"] - 30) < 1e-9
assert abs(scaled["b"] - 20) < 1e-9

zero = mod.scale_nonnegative({"a": 0, "b": 0}, 10)
assert abs(sum(zero.values()) - 10) < 1e-9
assert all(v >= 0 for v in zero.values())

empty = mod.scale_nonnegative({}, 10)
assert empty == {}

print("OK: consistency adjustment is non-negative and mass preserving")
