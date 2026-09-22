#!/usr/bin/env python3
"""
NaijaDeals QA Gate — test result classifier (prototype for the
"understand SQLITE_BUSY != failed business assertion" requirement).

Classifies node --test TAP output into 4 buckets so a suite can never be
silently reported as "N/M passed" when some cases never ran a real
assertion at all:

  1. ASSERTION   - a genuine expected/actual mismatch in business logic.
  2. INFRA        - blocked by a local test-runner/DB-driver artifact
                    (SQLITE_BUSY, connection resets, etc) - NOT a verdict
                    on the code under test. Must be re-run before any
                    pass/fail verdict is issued.
  3. SKIP         - explicitly skipped/cancelled by the runner.
  4. PASS         - real pass.

Usage: python3 scripts/qa-classify-test-results.py <tap-log-file>
"""
import sys, re

INFRA_MARKERS = [
    "SQLITE_BUSY",
    "database is locked",
    "NOSENTRY",
    "internal error; reference",
    "ECONNRESET",
    "ECONNREFUSED",
    "socket hang up",
]

def classify_block(block):
    for m in INFRA_MARKERS:
        if m in block:
            return "INFRA"
    if re.search(r"failed: \{.*Internal Server Error", block):
        if "D1_ERROR" in block or "internal error" in block or "SQLITE" in block:
            return "INFRA"
    if "AssertionError" in block or "code: 'ERR_ASSERTION'" in block:
        return "ASSERTION"
    return "UNKNOWN_FAIL"

def main(path):
    text = open(path).read()
    lines = text.split("\n")
    results = {"PASS": [], "INFRA": [], "ASSERTION": [], "UNKNOWN_FAIL": [], "SKIP": []}
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        m = re.match(r"^(not ok|ok) (\d+) - (.*)$", line)
        if m:
            status, num, name = m.groups()
            block_lines = []
            j = i + 1
            while j < n and (lines[j].startswith("  ") or lines[j].strip() in ("---", "...")):
                block_lines.append(lines[j])
                j += 1
            block = "\n".join(block_lines)
            if status == "ok":
                if "skip" in block.lower():
                    results["SKIP"].append((num, name))
                else:
                    results["PASS"].append((num, name))
            else:
                cls = classify_block(block)
                results[cls if cls in results else "UNKNOWN_FAIL"].append((num, name))
            i = j
        else:
            i += 1

    total = sum(len(v) for v in results.values())
    print(f"=== Classification for {path} ===")
    print(f"TOTAL SUBTESTS SEEN: {total}")
    for cat in ["PASS", "ASSERTION", "INFRA", "UNKNOWN_FAIL", "SKIP"]:
        items = results[cat]
        print(f"\n{cat}: {len(items)}")
        for num, name in items:
            print(f"  [{num}] {name}")

    print("\n=== VERDICT ===")
    if results["ASSERTION"] or results["UNKNOWN_FAIL"]:
        print("FAIL — real functional/assertion failure(s) present. DO NOT deploy.")
    elif results["INFRA"]:
        print(f"BLOCKED — {len(results['INFRA'])} subtest(s) never completed a real "
              f"assertion (infra/test-runner artifact). This is NOT a pass. "
              f"Re-run the affected file(s) in isolation (--test-concurrency=1, "
              f"one file at a time) before issuing any verdict.")
    else:
        print("CLEAN PASS — every subtest ran and asserted successfully.")

if __name__ == "__main__":
    main(sys.argv[1])
