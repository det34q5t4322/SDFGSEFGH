import urllib.request
import urllib.error
import time
import json

BASE = "http://127.0.0.1:8000"

print("=== 1. Testing unknown user ID enumeration protection ===")
t0 = time.time()
try:
    req = urllib.request.Request(f"{BASE}/api/avatar/88888888888")
    urllib.request.urlopen(req)
    print("FAIL: Expected 404 for unknown user, got 200!")
    assert False
except urllib.error.HTTPError as e:
    dt = time.time() - t0
    print(f"PASS: Status={e.code}, Reason={e.reason}, Time={dt:.4f}s")
    assert e.code == 404, f"Expected 404, got {e.code}"

print("\n=== 2. Testing known user (Ivan: 5670255003) ===")
t0 = time.time()
req = urllib.request.Request(f"{BASE}/api/avatar/5670255003")
with urllib.request.urlopen(req) as resp:
    dt = time.time() - t0
    print(f"PASS: Status={resp.status}, Content-Type={resp.headers.get('content-type')}, Time={dt:.4f}s")
    assert resp.status == 200

print("\n=== 3. Testing known user (Slava: 1814961081) ===")
t0 = time.time()
req = urllib.request.Request(f"{BASE}/api/avatar/1814961081")
with urllib.request.urlopen(req) as resp:
    dt = time.time() - t0
    print(f"PASS: Status={resp.status}, Content-Type={resp.headers.get('content-type')}, Time={dt:.4f}s")
    assert resp.status == 200

print("\n=== 4. Fast scan protection: 100 random IDs ===")
t0 = time.time()
codes = []
for i in range(100):
    try:
        r = urllib.request.Request(f"{BASE}/api/avatar/{9000000000 + i}")
        urllib.request.urlopen(r)
        codes.append(200)
    except urllib.error.HTTPError as e:
        codes.append(e.code)

total_dt = time.time() - t0
count_404 = sum(1 for c in codes if c == 404)
print(f"100 unknown IDs scanned in {total_dt:.3f}s (avg {total_dt/100*1000:.2f}ms/req)")
print(f"404 count: {count_404}/100")
assert count_404 == 100

print("\n=== 5. Verifying no cache pollution in avatars_cache for unknown IDs ===")
import os
cache_dir = "/var/www/college-schedule/server/avatars_cache"
polluted = [f for f in os.listdir(cache_dir) if f.startswith("88888888888") or f.startswith("90000000")]
print(f"Polluted files found: {polluted}")
assert len(polluted) == 0, f"Cache directory was polluted by scanned IDs: {polluted}"

print("\nALL SECURITY & VALIDATION TESTS PASSED!")
