#!/usr/bin/env python3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_model_data as b

def assert_close(a, bv, tol=1e-12):
    if abs(a-bv)>tol:
        raise AssertionError(f"{a} != {bv}")

# Population/exposure condition.
assert_close(b.fallback_fading_weight(0, 20), 0.0)
assert_close(b.fallback_fading_weight(20, 20), 0.0)

# Event-information condition: even a large population should not become
# fully local for a near-zero-probability event.
assert_close(b.fallback_fading_weight(150, 0.5), 0.0)
assert b.fallback_fading_weight(150, 5) > 0.0
assert b.fallback_fading_weight(150, 5) < 1.0

# Fully local only when both information signals are strong.
assert_close(b.fallback_fading_weight(100, 20), 1.0)
assert_close(b.fallback_fading_weight(1000, 200), 1.0)

# Fixed ex ante: same information gives same weight, independent of outcome.
w1=b.fallback_fading_weight(55, 8)
w2=b.fallback_fading_weight(55, 8)
assert_close(w1,w2)

# Monotonic in either information dimension.
weights_exp=[b.fallback_fading_weight(x, 20) for x in range(0,121)]
if any(weights_exp[i]>weights_exp[i+1] for i in range(len(weights_exp)-1)):
    raise AssertionError("Fading weight is not monotonic in exposure.")
weights_evt=[b.fallback_fading_weight(100, x) for x in range(0,31)]
if any(weights_evt[i]>weights_evt[i+1] for i in range(len(weights_evt)-1)):
    raise AssertionError("Fading weight is not monotonic in expected events.")

print("OK: fading is outcome-independent, information-based and can reach 100% local")
