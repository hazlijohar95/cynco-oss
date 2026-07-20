# @cynco/accounts tests

Run from the package directory:

```bash
AGENT=1 bun test                 # whole unit suite
AGENT=1 bun test test/AccountTree.keyboard.test.ts      # single file
```

Or from anywhere in the repo:

```bash
moonx accounts:test              # unit (bun + jsdom)
moonx accounts:test-e2e          # Playwright against the built dist
moonx accounts:benchmark         # mitata hot-path benchmarks
```

## Philosophy

- **bun + jsdom with stubbed geometry.** jsdom performs no layout, so
  `domHarness.ts` installs the jsdom environment (mock `PointerEvent`,
  `ResizeObserver`, always-intersecting `IntersectionObserver`,
  setTimeout-backed rAF) and `stubScrollerGeometry` declares the scroll
  container's rect and `scrollHeight` explicitly. Virtualization math is
  asserted against that exact geometry; anything needing real layout (real
  scrolling, sticky positioning, font measurement, trusted drags) lives in
  `test/e2e/`.
- **Model/view split.** `AccountTreeController.*.test.ts` files test the
  controller with no DOM at all — pure projections of visible paths, rows, and
  change events. `AccountTree.*.test.ts` files test the rendered view through
  the jsdom harness.
- **Behavioral projections over broad snapshots.** Suites project compact
  strings (`'path depth=N chain=A:B'`, `'path status×count'`) instead of
  snapshotting markup.
- **Snapshot policy: renderer canary only.** Exactly one snapshot exists — the
  full-row-markup canary in `AccountTreeRenderer.test.ts`
  (`__snapshots__/AccountTreeRenderer.test.ts.snap`). Intentional markup changes
  update it; everything else stays behavioral. Read the diff before updating.
- **Determinism.** Fixtures are the handcrafted `CHART_ACCOUNTS` chart (14
  accounts) and `makeWideChart` (up to ~1 020 rows for virtualization suites);
  no randomness, no wall-clock dependence.

## Suite map

| File                                          | Protects                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `AccountTree.contextMenu.test.ts`             | Context-menu request composition: trigger paths, anchor data, focus restore, rename handoff, session supersession                 |
| `AccountTree.decorations.test.ts`             | `renderDecorations` lanes: escaping, tones, 3-per-row cap, coexistence with status dots                                           |
| `AccountTree.dnd.collision.test.ts`           | View-level `dropCollision` strategies and onMove/onDropComplete/onDropError contracts                                             |
| `AccountTree.dnd.test.ts`                     | Drag & drop wiring via synthesized MouseEvents + stubbed `dataTransfer`: delegation, guards, visuals, drop application            |
| `AccountTree.icons.test.ts`                   | Icon resolver contract: built-in set, default heuristics, resolver runs once per rendered row per window commit                   |
| `AccountTree.ime.test.ts`                     | Composition guards: `isComposing` / legacy `keyCode === 229` keydowns never drive navigation, type-ahead, or rename commit/cancel |
| `AccountTree.keyboard.test.ts`                | Tree keyboard navigation on the `role="tree"` scroller                                                                            |
| `AccountTree.lazyLoad.test.ts`                | Lazy child loading in the view: loading/error placeholder rows, `aria-busy`, Retry reruns, stale-response discards                |
| `AccountTree.rename.test.ts`                  | Inline rename editor flow, including on wide virtualized charts                                                                   |
| `AccountTree.stickyStack.test.ts`             | Stacked sticky ancestors: aria-hidden mirrors, click forwarding, `STICKY_ANCESTOR_STACK_MAX` cap, flatten/search interplay        |
| `AccountTree.truncation.test.ts`              | Measured middle truncation against stubbed widths (10px per character, prototype-level stub surviving innerHTML rewrites)         |
| `AccountTree.virtualization.test.ts`          | Row-window math per density over a 1 020-row chart with stubbed geometry                                                          |
| `AccountTreeController.childLoad.test.ts`     | Load orchestration in the model: one load per gesture, token-gated stale discards, placeholder projection, remap/rebuild carry    |
| `AccountTreeController.dnd.test.ts`           | `getMovePlan` guard matrix (self, descendant, no-op moves)                                                                        |
| `AccountTreeController.dropCollision.test.ts` | `planMovePaths` breakdowns (reject/skip/replace), `applyMovePlan`, back-compat of `getMovePlan`/`movePaths`                       |
| `AccountTreeController.expansion.test.ts`     | `initialExpansion` modes, expand/collapse projections, change events                                                              |
| `AccountTreeController.flatten.test.ts`       | `flattenEmptyGroups` chain collapsing and flattened-name chains                                                                   |
| `AccountTreeController.rename.test.ts`        | `commitRename` validation and subtree remap                                                                                       |
| `AccountTreeController.searchModes.test.ts`   | `collapse-non-matches` and `hide-non-matches` search modes, cyclic match navigation, `{index,total}` readout                      |
| `AccountTreeController.selection.test.ts`     | Selection/focus model: plain, additive, range semantics                                                                           |
| `AccountTreeController.status.test.ts`        | `setAccountStatus` own-row dots and roll-up counts                                                                                |
| `AccountTreeRenderer.test.ts`                 | Row/sticky-row markup, escaping, minus signs (+ the single snapshot canary)                                                       |
| `colorScheme.test.ts`                         | `colorScheme` pinning on host and SSR preload                                                                                     |
| `hydration.test.ts`                           | `preloadAccountTreeHTML` row cap (`SSR_MAX_PRELOADED_ROWS` = 512) and zero-rebuild adoption                                       |

## E2e

`moonx accounts:test-e2e` self-installs Chromium if missing, builds the package
first (the build also asserts the inlined ledger-core engine never leaks as a
runtime import), then runs `*.pw.ts` via `test/e2e/playwright.config.ts`. The
Playwright `webServer` starts `accounts:test-e2e-server` — a Vite server rooted
at the package — so the fixture pages in `test/e2e/fixtures/*.html` import the
**built dist** as a consumer would. Fixtures expose `window.__*` readouts (typed
in `helpers/fixtureWindow.ts`) and raise a ready flag.

| Spec                               | Protects                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `tree-context-menu.pw.ts`          | Right-click / keyboard menu requests with real pointer coordinates                                                                   |
| `tree-dnd.pw.ts`                   | Manual HTML5 drag via trusted mouse input in Chromium                                                                                |
| `tree-flatten.pw.ts`               | Flatten toggle collapsing single-child chains in a real browser                                                                      |
| `tree-keyboard.pw.ts`              | Keyboard navigation with real focus + `aria-activedescendant` across full window rewrites                                            |
| `tree-search-sticky-stack.pw.ts`   | hide-non-matches filtering, F3 cycling, stacked sticky headers with click forwarding, and measured middle truncation with real fonts |
| `tree-style-isolation.pw.ts`       | Hostile page CSS cannot leak into shadow tree rows                                                                                   |
| `tree-virtualization-sticky.pw.ts` | Real scrolling keeps a bounded DOM; sticky header mirrors the right ancestor and stays aria-hidden                                   |

## Known gaps (audited against the suite as written)

| Gap                                        | Detail                                                                                                                                                                                                                                   | Severity | Mitigation                                                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Truncation measured against stubbed widths | Unit truncation assumes a uniform 10px per character; proportional-font measurement is covered by exactly one e2e scenario (`tree-search-sticky-stack.pw.ts`). Ellipsis placement under real kerning/ligatures is otherwise unverified.  | Medium   | E2e scenario with real fonts; measurement re-runs on window commits                                                              |
| DnD unit events are synthetic              | jsdom has no `DragEvent`/`DataTransfer`, so unit drags are bubbling MouseEvents with a stubbed `dataTransfer`. E2e does one trusted-mouse drag in Chromium; ghost images, `dropEffect` cursors, and cross-window drags have no coverage. | Medium   | Guard matrix fully covered at the model layer; core drop path e2e-verified                                                       |
| IME tests simulate composition flags       | `AccountTree.ime.test.ts` sets `isComposing` / `keyCode === 229` on synthetic keydowns. No real IME (or OS composition UI) is ever driven.                                                                                               | Low      | The guards read exactly those flags, so the simulated surface matches the code's decision inputs                                 |
| No accounts color-scheme e2e               | `colorScheme` is asserted in jsdom (inline style presence) only; journals has a computed-color e2e fixture, accounts does not.                                                                                                           | Low      | Same `applyHostColorScheme`-style mechanism as journals, which is e2e-covered there                                              |
| Chromium-only e2e                          | Single chromium project in `playwright.config.ts`; Firefox/WebKit unverified.                                                                                                                                                            | Medium   | Standards-only APIs; manual checks                                                                                               |
| No visual-regression coverage              | No screenshot assertions; the renderer canary catches markup drift only.                                                                                                                                                                 | Medium   | Snapshot canary; demo app for eyeball review                                                                                     |
| Large charts only in benchmarks            | Unit charts top out at ~1 020 rows; the 10k-entry medium workload from `@cynco/ledger-test-data` is exercised only by `scripts/benchmark.ts`, never asserted in tests.                                                                   | Low      | Windowing keeps per-frame work viewport-sized regardless of chart size; ledger-core scale tests cover the engine at 10k accounts |
| Lazy loading uses fake promises            | `loadChildren` is exercised with manually resolved/rejected promises; no real network latency, retries under flaky transport, or concurrent-expand races beyond the token-gating tests.                                                  | Low      | The token discard rules are the correctness boundary and are covered directly                                                    |
