---
name: performance
description:
  Use when changing loops, collection processing, invalidation logic, ledger
  traversal, posting aggregation, balance computation, virtualized rendering, or
  any code where repeated scans or boolean control flow affect performance or
  correctness.
---

# Performance

Avoid nested loops and O(n^2) operations unless there is a clear reason.

- Calculate expensive values once before a loop, not inside it.
- Prefer precomputed maps, sets, indexes, or a single backward scan over nested
  repeated scans.
- If you need to know whether meaningful elements remain, compute that boundary
  once before the main loop.
- Use typed arrays for hot per-row data (running balances, per-posting sums)
  rather than arrays of objects when the row count is large.

Preferred boundary pattern:

```typescript
let lastMeaningfulIndex = items.length - 1;
for (let i = items.length - 1; i >= 0; i--) {
  if (items[i].someCondition) {
    lastMeaningfulIndex = i;
    break;
  }
}

for (let i = 0; i <= lastMeaningfulIndex; i++) {
  const isLast = i === lastMeaningfulIndex;
  // ...
}
```

After changing boolean logic or invalidation paths, simplify the final control
flow before calling the work done. If code is already inside `if (foo)`, do not
keep `|| foo` in assignments inside that block.

## Measure, don't guess

Hot paths have committed benchmarks. When you change one, run its benchmark and
compare — a regression is as real as a failing test.

```bash
moonx ledger-core:benchmark
moonx accounts:benchmark
moonx journals:benchmark
```

Benchmarks use mitata and are `runInCI: 'always'` local-only tasks (no graph
edges). Do not add a benchmark to the CI target list; run it locally when the
code it covers changes.
