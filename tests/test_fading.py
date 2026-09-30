#!/usr/bin/env python3
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_model_data as b

def assert_close(a,bv,tol=1e-12):
    if abs(a-bv)>tol:
        raise AssertionError(f"{a} != {bv}")

assert_close(b.fallback_fading_weight(0),0.0)
assert_close(b.fallback_fading_weight(20),0.0)
assert b.fallback_fading_weight(60) > 0.0
assert b.fallback_fading_weight(60) < 1.0
assert_close(b.fallback_fading_weight(100),1.0)
assert_close(b.fallback_fading_weight(1000),1.0)

# Weight depends only on exposure, not on observed outcome or benchmark error.
w1=b.fallback_fading_weight(55)
w2=b.fallback_fading_weight(55)
assert_close(w1,w2)

# Smoothstep should be monotonic.
weights=[b.fallback_fading_weight(x) for x in range(0,121)]
if any(weights[i]>weights[i+1] for i in range(len(weights)-1)):
    raise AssertionError("Fading weight is not monotonic.")

print("OK: fading is outcome-independent, monotonic and reaches 100% local at exposure >=100")
