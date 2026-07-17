// mitata benchmarks for the account tree hot paths: controller construction
// over the shared medium workload (10k entries), windowed row reads +
// rendering, expansion projection rebuilds, and search sessions.
//
// Fixtures come from @cynco/ledger-test-data (devDependency; no cycle — the
// fixture package depends only on ledger-store) so every package in the
// suite benchmarks against the same deterministic ledgers.

import { workloads } from '@cynco/ledger-test-data';
import { bench, do_not_optimize, group, run } from 'mitata';

import { AccountTreeController } from '../src/model/AccountTreeController';
import { renderAccountRowsHTML } from '../src/render/AccountTreeRenderer';

const VIEWPORT_HEIGHT = 600;
const RENDER_OPTIONS = { currency: 'MYR', idPrefix: 'bench' } as const;

const entries = workloads.medium();

// Shared controller for read benchmarks (built once so read timings do not
// include construction).
const controller = new AccountTreeController({ entries });
controller.expandAll();
const totalHeight = controller.getTotalHeight();

// Rotate scroll positions so window reads are not a single cached slice.
let scrollCursor = 0;

group('AccountTreeController (medium workload: 10k entries)', () => {
  bench('build (store + indexes)', () => {
    do_not_optimize(new AccountTreeController({ entries }));
  });

  bench('getVisibleRange + getRows + render window', () => {
    scrollCursor = (scrollCursor + 977) % Math.max(1, totalHeight);
    const range = controller.getVisibleRange(scrollCursor, VIEWPORT_HEIGHT);
    do_not_optimize(
      renderAccountRowsHTML(
        controller.getRows(range.start, range.end),
        range,
        RENDER_OPTIONS
      )
    );
  });

  bench('expandAll + projection rebuild', () => {
    controller.collapseAll();
    controller.expandAll();
    do_not_optimize(controller.getVisibleCount());
  });

  bench('beginSearch("cash") + endSearch', () => {
    do_not_optimize(controller.beginSearch('cash'));
    controller.endSearch();
  });
});

await run();
