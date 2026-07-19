# @cynco/journals tests

Run from the package directory:

```bash
AGENT=1 bun test                 # whole unit suite
AGENT=1 bun test test/Register.virtualization.test.ts   # single file
```

Or from anywhere in the repo:

```bash
moonx journals:test              # unit (bun + jsdom)
moonx journals:test-e2e          # Playwright against the built dist
moonx journals:benchmark         # mitata hot-path benchmarks
```

## Philosophy

- **bun + jsdom with stubbed geometry.** jsdom performs no layout, so the suite
  never pretends it does. `domHarness.ts` installs a jsdom environment (plus
  mock `PointerEvent`, `ResizeObserver`, an always-intersecting
  `IntersectionObserver`, and a setTimeout-backed `requestAnimationFrame`), and
  `stubScrollerGeometry` declares scroll-container geometry explicitly (bounding
  rect height, `scrollHeight`, a clamping `scrollTo`). Windowing math is
  therefore tested against exact, known pixel geometry — anything that needs
  _real_ layout (actual scrolling, sticky positioning, computed colors, shadow
  style isolation, a real Worker) lives in `test/e2e/`.
- **Behavioral projections over broad snapshots.** Tests assert compact
  projections (posting-row digests, visible row ranges, ARIA readouts) rather
  than whole render results.
- **Snapshot policy: renderer canaries only.** Exactly three snapshots exist,
  one full-fidelity HTML canary per pure renderer: `EntryRenderer.test.ts`,
  `EntryDiffRenderer.test.ts`, and `ReconciliationRenderer.test.ts` (see
  `__snapshots__/`). Any intentional markup change must update the canary;
  everything else stays behavioral. When a canary fails, read the diff — do not
  reflexively `bun test -u`.
- **Byte-identity for worker/SSR parity.** The worker pool and SSR preloads run
  the same renderers as the client, and tests hold them to it:
  `worker.protocol.test.ts` and `Register.workerPool.test.ts` assert worker
  output is byte-identical to the sync renderer (including threaded `idPrefix`),
  and the hydration suites assert SSR markup is adopted with zero DOM rebuilds
  (byte-identical `innerHTML`, preserved node identity).
- **Determinism.** Fixtures are handcrafted (`makeEntry`, `makeRows`,
  `makeStatementLine` in `domHarness.ts`) with stable values; nothing depends on
  `Math.random` or wall-clock time. `SmoothScroller.test.ts` replaces rAF with a
  manual frame pump so the spring is driven with fake timestamps instead of real
  timing.

## Suite map

| File                                   | Protects                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `colorScheme.test.ts`                  | `colorScheme` option pins (or leaves unset) an inline `color-scheme` on component hosts and SSR preloads                                                      |
| `diffEntryVersions.test.ts`            | Pure diff compute: `diffWords`, field diffs, `MAX_FIELD_DIFF_LENGTH` bail-out                                                                                 |
| `EntryDiffRenderer.test.ts`            | Audit-trail diff markup (projections + the diff snapshot canary)                                                                                              |
| `EntryRenderer.test.ts`                | Journal entry card markup: postings, signs, escaping (+ the entry snapshot canary)                                                                            |
| `EntryStream.announcements.test.ts`    | Live-region announcements while entries stream in                                                                                                             |
| `EntryStream.test.ts`                  | Stream batching via rAF, stick-to-bottom autoscroll, stream completion                                                                                        |
| `formatMinorUnits.test.ts`             | Minor-unit formatting: per-currency decimals, sign modes, U+2212 minus, no-float exactness                                                                    |
| `hydration.test.ts`                    | SSR preload → hydrate for JournalEntry / Register / EntryDiff (declarative shadow DOM adoption)                                                               |
| `LedgerView.anchoring.test.ts`         | Scroll anchoring across section data updates (section-top math from explicit densities)                                                                       |
| `LedgerView.hydration.test.ts`         | `preloadLedgerViewHTML` row caps (`SSR_MAX_PRELOADED_ROWS_PER_SECTION` = 128, `SSR_MAX_PRELOADED_TOTAL_ROWS` = 512), zero-rebuild adoption, ARIA id agreement |
| `LedgerView.keyboard.test.ts`          | Cross-section keyboard navigation over one shared virtualizer                                                                                                 |
| `LedgerView.reconcile.test.ts`         | Incremental section reconciliation: add/remove/update sections without full rebuilds                                                                          |
| `proposeMatches.test.ts`               | Reconciliation matching engine: exact, date-window, and sum passes, match ids, deltas                                                                         |
| `Reconciliation.announcements.test.ts` | Live-region announcements for accept/reject/undo                                                                                                              |
| `Reconciliation.colorScheme.test.ts`   | `colorScheme` pinning on the reconciliation host                                                                                                              |
| `Reconciliation.interaction.test.ts`   | Accept/reject/undo flows and the per-currency difference readout                                                                                              |
| `ReconciliationRenderer.test.ts`       | Reconciliation markup + `computeReconciliationTotals` (+ the reconciliation snapshot canary)                                                                  |
| `Register.aria.test.ts`                | Grid ARIA contract; re-windowed rows reproduce SSR row ids byte for byte                                                                                      |
| `Register.filter.test.ts`              | Filter application, lazy corpus reuse, byte-identical restore when the filter clears                                                                          |
| `Register.grouping.test.ts`            | Grouped row model, prefix-sum offsets, grouped windows, period labels                                                                                         |
| `Register.keyboard.test.ts`            | Grid keyboard navigation and selection callbacks                                                                                                              |
| `Register.rangeSelection.test.ts`      | Range/additive selection semantics                                                                                                                            |
| `Register.scrollTo.test.ts`            | `scrollToRow` / `scrollToDate` target math against deterministic geometry                                                                                     |
| `Register.stickyGroupLabel.test.ts`    | Sticky period-label mirror resolution at the scroll seam                                                                                                      |
| `Register.virtualization.test.ts`      | Row-window math (1 000 rows, explicit overscan) against stubbed geometry                                                                                      |
| `Register.workerPool.test.ts`          | Register + pool integration: byte-identical windows sync vs worker, stale-response drops (mock transport)                                                     |
| `RegisterRenderer.test.ts`             | Register header/row markup and escaping                                                                                                                       |
| `SmoothScroller.test.ts`               | Spring engine under pumped frames: settle, `MAX_SMOOTH_SCROLL_FRAME_DT` clamp, user-input cancellation                                                        |
| `worker.protocol.test.ts`              | `handleWorkerRequest` protocol: initialize ack, byte-identical render/match responses, `idPrefix` threading                                                   |
| `WorkerPoolManager.test.ts`            | Pool lifecycle: dispatch, error responses, worker crashes, terminate, main-thread fallback                                                                    |

## E2e

`moonx journals:test-e2e` self-installs Chromium if missing
(`check-playwright-binary.ts`), builds the package (task dep), then runs
`*.pw.ts` via the config in `test/e2e/playwright.config.ts`. The Playwright
`webServer` starts `journals:test-e2e-server` — a Vite server rooted at the
package directory — so the static fixture pages in `test/e2e/fixtures/*.html`
import the **built dist** (`/dist/index.js`, `/dist/worker/...`) exactly as a
consumer would. Each fixture mounts components, exposes readout functions on
`window.__*`, and raises a ready flag the spec awaits.

| Spec                               | Protects                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `color-scheme.pw.ts`               | Page-driven vs pinned color scheme resolves to the right computed backgrounds when OS and page preferences disagree |
| `entry-stream.pw.ts`               | Real streamed entries appear incrementally with autoscroll                                                          |
| `ledger-view-scroll.pw.ts`         | Real scrolling across three 500-row sections: `scrollToSection`, sticky readouts, grouped scroller                  |
| `reconciliation-interaction.pw.ts` | Accept/reject with real computed match colors                                                                       |
| `register-keyboard.pw.ts`          | Focus, `aria-activedescendant`, and outline under trusted keyboard input                                            |
| `register-style-isolation.pw.ts`   | Hostile page CSS cannot leak into the shadow register                                                               |
| `register-virtualization.pw.ts`    | 10 000-row register under real scrolling keeps a bounded DOM (window + overscan headroom)                           |
| `worker-pool.pw.ts`                | A REAL module worker: pool init, byte-identical windows, broken-worker-URL fallback to the main thread              |

## Known gaps (audited against the suite as written)

| Gap                                                         | Detail                                                                                                                                                                                                                                                                                          | Severity | Mitigation                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| Real scroll physics only partially covered                  | Unit windowing runs against stubbed geometry and synthetic `scroll` events; e2e drives real Chromium scrolls but not momentum/touch scrolling. The 800px overscan exists specifically for Safari momentum-scroll blanking (`src/components/Virtualizer.ts`), and no automated test runs Safari. | Medium   | Overscan headroom; e2e DOM-bound assertions catch gross window regressions |
| Chromium-only e2e                                           | `playwright.config.ts` declares a single chromium project. Firefox/WebKit behavior (scrolling, workers, declarative shadow DOM) is unverified.                                                                                                                                                  | Medium   | Manual checks; standards-only APIs in src                                  |
| SmoothScroller never sees real rAF timing                   | The spring is tested with pumped frames and fake timestamps (including the `MAX_SMOOTH_SCROLL_FRAME_DT` clamp). Real frame-cadence behavior (jank, background-tab throttling) is untested.                                                                                                      | Low      | Clamp bounds the worst case by construction                                |
| Fixed-duration waits in async suites                        | Many suites settle async pipelines with `await wait(n)`; single-stage rAF flushes are deterministic in the setTimeout-backed harness, but multi-stage pipelines can race on loaded CI runners — `Register.workerPool.test.ts` flaked exactly this way and now settles by quiescence instead.    | Medium   | Convert waits to quiescence polling when a suite flakes; deadline-bounded  |
| No visual-regression coverage                               | No screenshot assertions anywhere. The three renderer snapshot canaries catch markup drift, and the style-isolation/color-scheme e2e check a few computed styles, but layout/paint regressions are invisible to CI.                                                                             | Medium   | Snapshot canaries; demo app for eyeball review                             |
| Worker pool unit-tested against a mock transport            | `mockWorker.ts` runs the real `handleWorkerRequest` behind a fake `postMessage` boundary; a real module worker is exercised only by `worker-pool.pw.ts` (Chromium). Structured-clone edge cases and worker startup latency are otherwise unmodelled.                                            | Low      | Protocol byte-identity tests; e2e covers init + fallback                   |
| LedgerView SSR caps untested at pathological section counts | Cap tests top out at 8 sections / 300-row sections. Preload cost and hydration with hundreds of registers behind one virtualizer are unmeasured.                                                                                                                                                | Low      | Caps (128/section, 512 total) bound preload size by construction           |
| e2e retry absorbs a known race                              | `retries: 1` exists to absorb a rare rAF/window-commit race under parallel worker pressure (see `playwright.config.ts` comment) rather than the race being fixed.                                                                                                                               | Low      | Single retry keeps genuinely broken suites loud                            |
