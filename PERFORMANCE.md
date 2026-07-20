# Performance runbook

How to measure CyncoJS performance, what each benchmark guards, and the
invariants that must not regress. Microbenchmarks answer "did a hot function get
slower"; browser traces answer "did scrolling get worse". Use the right tool —
and when a change touches CSS, layout, or the rendering pipeline, demand a
trace, not a mitata number.

## Benchmark inventory

All three are mitata suites with deterministic fixtures (seeded or
formula-generated data; no `Math.random` at measurement time), runnable in agent
shells (`runInCI: 'always'`) and never part of any CI lane.

### `moonx ledger-core:benchmark`

`packages/ledger-core/scripts/benchmark.ts`. Inlined fixture generation (local
mulberry32; importing `@cynco/ledger-test-data` would create a workspace cycle):
50 000 leaf accounts, 100 000 balanced entries.

| Group                  | Measures                                                                                                                | Invariant guarded                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AccountStore           | build; `getVisibleSlice` viewport of 100 (middle); expandAll/collapseAll rebuilds                                       | Slice reads are viewport-sized regardless of tree size (slice-first reads, `AccountStore.getVisibleSlice`)                                                                             |
| AccountStore mutations | 100-move burst + ONE projection read; 1k `addAccounts` + read                                                           | A mutation burst amortizes to a single derived rebuild — `derived == null` IS the dirty flag (`packages/ledger-core/src/AccountStore.ts:64`), so cost scales with reads, not mutations |
| EntryStore             | build (sort + id index); cold register build; warm slice read; descendants roll-up; `addEntriesAsync` 100k in 5k chunks | Warm register slices are index reads off cached per-account prefix sums — never a re-scan of the entry list (`packages/ledger-core/src/EntryStore.ts` header)                          |

### `moonx journals:benchmark`

`packages/journals/scripts/benchmark.ts`. 100 000 deterministic register rows.

| Bench                                              | Measures                                     | Invariant guarded                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `formatMinorUnits` (2-decimal, 0-decimal negative) | Per-amount format cost                       | The hot path is pure digit-string math — no float division ever touches an amount, cost is flat per call (`packages/journals/src/utils/formatMinorUnits.ts`) |
| `renderEntryHTML`                                  | One entry card render                        | Renderer stays cheap enough to run per-window without pooling                                                                                                |
| `renderRegisterRowsHTML`: 60-row window of 100k    | Windowed render from the middle of 100k rows | Windowed render cost is independent of total row count — only the window's rows are visited                                                                  |

### `moonx accounts:benchmark`

`packages/accounts/scripts/benchmark.ts`. Shared `medium` workload (10k entries)
from `@cynco/ledger-test-data`.

| Bench                                                                  | Measures                                                               | Invariant guarded                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| controller build                                                       | Store + index construction                                             | One-time cost stays bounded                                       |
| `getVisibleRange` + `getRows` + render window (rotating scroll cursor) | The per-scroll-frame read+render path, deliberately not a cached slice | Windowed read+render is viewport-sized, independent of chart size |
| expandAll + projection rebuild                                         | Full projection rebuild                                                | Rebuild is a single pass, not per-row invalidation                |
| `beginSearch` + `endSearch`                                            | A whole search session                                                 | Search sessions don't leave residual cost                         |
| `commitRename` / `movePaths` remaps                                    | Full store rebuild from remapped entries                               | Remap cost is one rebuild, flat per operation                     |

## Browser profiling recipe

Microbenchmarks cannot see layout, paint, or GC pressure. For anything
user-perceivable, trace the demo app:

1. Optional: in `apps/demo/src/main.ts`, flip `const CRAZY_LEDGER = false` to
   `true`. This adds the `large` workload (100 000 entries) to the workload
   selector and selects it by default. The default `medium` (10k entries) is
   fine for most investigations. `USE_WORKER_POOL` in the same file toggles
   worker-pool vs main-thread window rendering (output is byte-identical either
   way).
2. Serve the demo: `moonx demo:dev --ignore-ci-checks` (the dev task is
   CI-skipped; agent shells are CI-marked). Vite serves on port 4600 after
   dependency dists build.
3. What stresses what:
   - **Register** section — single-account virtualized register; with
     CRAZY_LEDGER + `large` this is the 100k-row scroll stress. Grouping
     (`register-groupby`) adds the mixed-height/prefix-sum path and the sticky
     period label.
   - **Ledger view** — five registers behind one shared virtualizer; stresses
     multi-section window commits and scroll anchoring.
   - **Account tree** — windowed tree rows, sticky ancestors, search.
   - **Entry gallery / reconciliation** — mostly static; useful for first-render
     cost, not scroll.
4. Capture: Chrome DevTools → Performance → record → flick-scroll the register
   hard for a few seconds (wheel bursts and scrollbar drags behave differently;
   do both) → stop. Keep browser, viewport, density, workload, and worker-pool
   setting identical between before/after traces.
5. Read the trace. "Good" looks like:
   - **One layout read per frame.** Scroll geometry (scrollTop / height /
     scrollHeight) is cached behind dirty flags in the Virtualizer, so a burst
     of scroll events costs one read per rAF
     (`packages/journals/src/components/Virtualizer.ts`, class comment). A
     forced-reflow warning inside the scroll handler is a regression.
   - **No long tasks from window commits.** A commit is two spacer height writes
     plus ONE `innerHTML` write for the bounded row window
     (`packages/journals/src/components/Register.ts`, `applyWindow`). Commits
     should be well under a frame; on the worker path only the spacer writes
     land synchronously and row HTML arrives on a later frame.
   - **No per-row work per frame.** Grouped windowing is two binary searches
     over precomputed prefix sums; the sticky label resolve is one more
     (`computeGroupedRowWindow.ts`, `computeRowModelOffsets.ts`,
     `findRowIndexAtOffset.ts` in `packages/journals/src/utils/`). Any O(rows)
     walk appearing in the scroll path is a regression.

## Regression protocol

1. Run the affected benchmark on the base commit, save the output.
2. Run it on your change. Same machine, same power state, nothing heavy in the
   background.
3. Interpreting mitata: single-digit-percent deltas are usually noise — re-run
   both sides before believing them. Warmup matters: JIT state and caches differ
   between the first and later iterations, which is why the suites build shared
   stores up front and rotate cursors to control cache hits deliberately (cold
   vs warm register reads are separate benches on purpose). Compare like against
   like.
4. Demand a trace instead of a microbenchmark when the change touches CSS, DOM
   structure, layout, paint, scheduling (rAF/worker), or anything where the cost
   lives in the browser rather than in a pure function. A mitata win can coexist
   with a scroll regression.
5. Large deltas in "build" benches matter less than deltas in per-frame benches
   (window read+render, slice reads): builds happen once, frames happen at 60Hz.

## Performance invariants ("no accidental O(n²)" enforcement points)

From `AGENTS.md`: precompute boundaries before loops, prefer maps/sets, use
typed arrays for hot per-row data. Concretely:

- **Prefix-sum windowing.**
  `packages/journals/src/utils/computeRowModelOffsets.ts` builds cumulative
  offsets once per data update (Float64Array, exact for integer px);
  `computeGroupedRowWindow.ts` maps a pixel window to row indices with two
  binary searches; `findRowIndexAtOffset.ts` does the same for the sticky label.
  Nothing walks rows per scroll frame.
- **Dirty-flag geometry cache.**
  `packages/journals/src/components/Virtualizer.ts` caches
  scrollTop/height/scrollHeight behind dirty flags: one layout read per frame
  per burst, all work funneled through the shared rAF queue.
- **Bounded window commits.** `packages/journals/src/components/Register.ts`
  (`applyWindow`): spacer heights come straight from the prefix sums, rows are
  one `innerHTML` write of a viewport-bounded window — no element pooling needed
  because the window can never grow with the dataset.
- **Lazy corpora.** `packages/journals/src/utils/buildRegisterFilterCorpus.ts`:
  one O(n) lowercase pass per data version, built on FIRST filter use and reused
  across query keystrokes; dropped on `setRows`.
- **`derived == null` rebuild amortization.**
  `packages/ledger-core/src/AccountStore.ts:64`: the derived struct-of-arrays
  topology is one nullable object; every mutation just nulls it, and the next
  read pays for exactly one rebuild. The `100-move burst + one projection read`
  benchmark exists to keep this honest.
- **Slice-first reads.** `AccountStore.getVisibleSlice` materializes only the
  requested viewport rows over shared typed-array state; `EntryStore` serves
  register slices from cached per-account prefix-sum indexes (one Float64Array
  per currency) so scroll-frame re-reads never re-scan the entry list.
