# @cynco/ledger-core tests

Run from the package directory:

```bash
AGENT=1 bun test                 # whole suite
AGENT=1 bun test test/scheduler.test.ts                 # single file
```

Or from anywhere in the repo:

```bash
moonx ledger-core:test          # unit
moonx ledger-core:benchmark     # mitata scale benchmarks
```

There is no e2e lane: this package is a pure data layer with no DOM, so
`bun test` runs it directly — no jsdom harness, no stubbed geometry, no
snapshots.

## Philosophy

- **Pure-data assertions.** Stores are exercised through their public API and
  asserted via compact projections (visible paths, row slices, balance maps,
  mutation-event sequences). No snapshots exist in this package.
- **Determinism.** Fixtures are handcrafted or generated from fixed formulas
  (zero-padded names so code-point order equals numeric order, deterministic id
  shuffles); nothing depends on randomness or wall-clock time — except the
  scheduler suite, which by nature measures real elapsed time (see gaps).
- **Money invariants are tested where they live.** Integer minor units,
  per-currency balance checks, and the safe-integer guard
  (`assertSafeMinorUnits`, `addMinorUnits` throwing at
  `Number.MAX_SAFE_INTEGER`) are covered in `money.balance.test.ts`, in line
  with the repo-wide money rules in `AGENTS.md`.

## Suite map

| File                              | Protects                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accountPath.parsing.test.ts`     | Canonical colon-delimited path validation, segments, ancestors, unicode names, degenerate rejects                                                         |
| `AccountStore.childLoad.test.ts`  | Child-load state machine: transitions, event honesty, error retention/retry, survival across rebuilds and moves, projection group-ness                    |
| `AccountStore.mutations.test.ts`  | Move/rename/add/remove mutations and honest mutation events, including scheduler-driven paths                                                             |
| `AccountStore.projection.test.ts` | Tree building, sibling sorting, balances and roll-ups, zero-activity accounts declared via `accountPaths`                                                 |
| `AccountStore.scale.test.ts`      | Positional invariants over a 10 110-account tree (10×10×100 + implied groups)                                                                             |
| `EntryStore.ingest.test.ts`       | Chunked async ingest: equivalence to sync adds, async-generator sources, scheduler tasks, whole-chunk abort atomicity, dedupe accounting, mutation events |
| `EntryStore.ordering.test.ts`     | Merge-insert invariant: incremental out-of-order batches leave the list in exact (date, id) order, identical to one sorted insert                         |
| `EntryStore.register.test.ts`     | Register rows with running balances, filters, mutation invalidation                                                                                       |
| `money.balance.test.ts`           | Minor-unit arithmetic, per-currency sums, balance checks, safe-integer guard                                                                              |
| `scheduler.test.ts`               | Cooperative scheduler: slicing under a deadline, `timeRemaining` countdown, abort, queue-full errors, overrun metrics                                     |

## Known gaps (audited against the suite as written)

| Gap                                               | Detail                                                                                                                                                                                                                                                                                      | Severity | Mitigation                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| Scheduler assertions are wall-clock               | `scheduler.test.ts` busy-waits (`burnMs`) and asserts real-time bounds such as `maxSliceOverrunMs < 50` and minimum slice counts. Under heavy CI load these can flake.                                                                                                                      | Medium   | Bounds are generous relative to the 8ms default budget; failures so far indicate real regressions  |
| Benchmark scale never asserted in tests           | Unit scale tops out at 10 110 accounts; the 50k-account / 100k-entry fixtures live only in `scripts/benchmark.ts`, and the 1M-entry `xl` workload defined in `@cynco/ledger-test-data` is exercised by no test or benchmark at all. Correctness at those sizes is extrapolated, not proven. | Medium   | Scale test pins the structural invariants; benchmarks catch gross complexity regressions when run  |
| No cross-store consistency test                   | No test feeds the same ledger to both `AccountStore` and `EntryStore` and cross-checks roll-up balances against register running balances. Each store is verified independently.                                                                                                            | Medium   | Both are tested against the shared money helpers; the demo app exercises them together, unasserted |
| No property-based / fuzz coverage                 | Path parsing, balance checks, and mutation sequences are tested with handcrafted fixtures only; no randomized-input testing of the invariants.                                                                                                                                              | Low      | Fixtures were chosen adversarially (unicode segments, duplicate ids, shuffled dates)               |
| Float64Array prefix-sum exactness by construction | Running balances are Float64Array prefix sums, exact for integer minor units up to 2^53. The guard against exceeding that range is tested at the arithmetic layer, not at the index layer.                                                                                                  | Low      | `assertSafeMinorUnits` gates inputs before they reach the index                                    |
| Child-load callers are simulated                  | `AccountStore.childLoad.test.ts` drives the state machine directly; the real consumer (`@cynco/accounts` lazy loading) is tested in that package, so cross-package integration relies on both suites agreeing on the contract.                                                              | Low      | The contract is small (5 methods) and both suites assert it independently                          |
