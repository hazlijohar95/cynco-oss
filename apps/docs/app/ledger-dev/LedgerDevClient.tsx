'use client';

import { AccountTree } from '@cynco/accounts';
import type { RegisterRowData, RowRange } from '@cynco/journals';
import { Register } from '@cynco/journals';
import { getOrCreateWorkerPoolSingleton } from '@cynco/journals/worker';
import type { WorkerPoolManager } from '@cynco/journals/worker';
import {
  createCooperativeScheduler,
  EntryStore,
  SchedulerAbortedError,
} from '@cynco/ledger-core';
import type { CooperativeScheduler, LedgerEntry } from '@cynco/ledger-core';
import {
  WORKLOAD_ENTRY_COUNTS,
  type WorkloadName,
  workloads,
} from '@cynco/ledger-test-data';
import { Play, Shuffle, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { buildRegisterRowsChunked } from './buildRegisterRowsChunked';
import { countAccountsChunked } from './countAccountsChunked';
import { Button } from '@/components/ui/button';
import { SwitchPill } from '@/components/ui/switch-pill';
import { cn } from '@/lib/utils';

// The register shows the busiest generated account (roughly a third of all
// entries post to it), so the row count exercises the largest projection
// each workload can produce.
const REGISTER_ACCOUNT = 'Assets:Current:Cash-Maybank';

// Every named preset @cynco/ledger-test-data ships, smallest first. The 1M
// workload is offered deliberately: generation is a single synchronous pass
// (measured ~1.6s in Bun on an M4; browsers land in the same ballpark), and
// the page is honest about the tab blocking for exactly that measured time.
const WORKLOAD_ORDER: readonly WorkloadName[] = [
  'small',
  'medium',
  'large',
  'xl',
];

// Auto-scroll stress cadence. The smooth-scroll spring settles in ~440ms,
// so a 600ms period keeps the register in continuous motion without
// stacking retargets faster than the spring can express them.
const STRESS_INTERVAL_MS = 600;

// Rendered-window poll period. getRenderedRange() is a field read, so
// polling is nearly free; 250ms is fast enough to feel live while scrolling.
const STATS_POLL_MS = 250;

type LabPhase = 'idle' | 'generating' | 'projecting' | 'ready';

interface LabTimings {
  /** Synchronous seeded generation pass (blocks the tab; shown honestly). */
  generateMs: number;
  /** Synchronous EntryStore build (sort + id index + account indexes). */
  storeBuildMs: number;
  /** Cooperative (time-sliced) register-row projection + account count. */
  projectionMs: number;
}

interface LabData {
  workload: WorkloadName;
  entries: LedgerEntry[];
  rows: RegisterRowData[];
  accountCount: number;
  timings: LabTimings;
}

// Resolves after the browser has painted the frame that the pending state
// update produced: two rAFs guarantee the commit painted, and the trailing
// setTimeout escapes the rAF callback so the synchronous generation block
// that follows does not run inside the frame budget.
function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    });
  });
}

// Lazily creates (or reuses) the page-wide worker pool. Worker construction
// is a bundler concern, so the factory points at the local journals-worker
// entry; any synchronous failure (no module-worker support) returns null
// and the register simply runs its main-thread path. Failures AFTER
// construction are handled inside the pool itself — every job falls back to
// the main thread transparently.
function acquireWorkerPool(): WorkerPoolManager | null {
  try {
    return getOrCreateWorkerPoolSingleton({
      workerFactory: () =>
        new Worker(new URL('./journals-worker.ts', import.meta.url), {
          type: 'module',
        }),
    });
  } catch {
    return null;
  }
}

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function formatMs(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} ms`;
}

// Pool state for the stats line, as a comparable string so the poll only
// re-renders when something actually changed. `workersFailed` means every
// window render silently ran on the main thread — worth surfacing, since
// the whole point of the toggle is to compare the two paths.
function describePool(pool: WorkerPoolManager | null): string {
  if (pool == null) {
    return 'unavailable — main-thread fallback';
  }
  const stats = pool.getStats();
  if (stats.workersFailed) {
    return 'workers failed — main-thread fallback';
  }
  return `${String(stats.totalWorkers)} workers · ${String(stats.busyWorkers)} busy`;
}

// The lab surface: pick a seeded workload, watch it generate with real
// performance.now() timings, then scroll (or stress-scroll) the virtualized
// register while the rendered-window readout proves the DOM stays
// viewport-sized. All wiring goes through the packages' public APIs — the
// same calls an integrating app would make.
export function LedgerDevClient() {
  const [phase, setPhase] = useState<LabPhase>('idle');
  const [pendingWorkload, setPendingWorkload] = useState<WorkloadName | null>(
    null
  );
  const [data, setData] = useState<LabData | null>(null);
  const [poolEnabled, setPoolEnabled] = useState(true);
  const [treeEnabled, setTreeEnabled] = useState(true);
  const [treeBuildMs, setTreeBuildMs] = useState<number | null>(null);
  const [windowRange, setWindowRange] = useState<RowRange | null>(null);
  const [poolReadout, setPoolReadout] = useState<string | null>(null);
  const [stressRunning, setStressRunning] = useState(false);

  const registerHostRef = useRef<HTMLDivElement>(null);
  const treeHostRef = useRef<HTMLDivElement>(null);
  const registerRef = useRef<Register | null>(null);
  // The in-flight projection scheduler, so unmount can abort mid-workload
  // instead of leaving slices running against a dead page.
  const schedulerRef = useRef<CooperativeScheduler | null>(null);
  // Monotonic run token: a completion whose token no longer matches was
  // superseded (or the page unmounted) and must not touch state.
  const runTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      runTokenRef.current += 1;
      schedulerRef.current?.abort('lab unmounted');
    };
  }, []);

  const generate = useCallback(async (workload: WorkloadName) => {
    const token = ++runTokenRef.current;
    schedulerRef.current?.abort('superseded by a new workload');
    setPendingWorkload(workload);
    setPhase('generating');
    setData(null);
    setWindowRange(null);
    setTreeBuildMs(null);
    setStressRunning(false);
    // Let the busy state paint before the synchronous block starts —
    // otherwise the user clicks and the page freezes with no feedback.
    await afterNextPaint();
    if (runTokenRef.current !== token) return;

    // Phase 1+2 are single synchronous passes (the seeded generator and the
    // store constructor have no incremental APIs), so the tab blocks here
    // for exactly the durations shown in the readout. No smoothing, no
    // precomputed numbers — performance.now() around the real calls.
    const generateStart = performance.now();
    const entries = workloads[workload]();
    const generateMs = performance.now() - generateStart;
    const storeStart = performance.now();
    const store = new EntryStore(entries);
    const storeBuildMs = performance.now() - storeStart;

    setPhase('projecting');
    await afterNextPaint();
    if (runTokenRef.current !== token) return;

    // Phase 3 is cooperative: register rows and the account count run as
    // time-sliced tasks (8ms slices) through @cynco/ledger-core's
    // scheduler, so input and paint stay live during the biggest workloads.
    const scheduler = createCooperativeScheduler();
    schedulerRef.current = scheduler;
    const projectionStart = performance.now();
    let projection: { rows: RegisterRowData[]; accountCount: number } | null =
      null;
    try {
      const [rows, accountCount] = await Promise.all([
        buildRegisterRowsChunked(scheduler, store, REGISTER_ACCOUNT),
        countAccountsChunked(scheduler, entries),
      ]);
      projection = { rows, accountCount };
    } catch (error) {
      if (error instanceof SchedulerAbortedError) return;
      throw error;
    }
    const projectionMs = performance.now() - projectionStart;
    if (runTokenRef.current !== token) return;

    schedulerRef.current = null;
    setData({
      workload,
      entries,
      rows: projection.rows,
      accountCount: projection.accountCount,
      timings: { generateMs, storeBuildMs, projectionMs },
    });
    setPhase('ready');
  }, []);

  // (Re)mounts the vanilla Register whenever the data or the worker-pool
  // toggle changes. workerPool is a constructor option, so flipping the
  // toggle rebuilds the instance — deliberately exercising the cold
  // construction path both ways; output is byte-identical on either path.
  useEffect(() => {
    const host = registerHostRef.current;
    if (data == null || host == null) return;
    const pool = poolEnabled ? acquireWorkerPool() : null;
    setPoolReadout(poolEnabled ? describePool(pool) : 'off');
    const register = new Register({
      account: REGISTER_ACCOUNT,
      density: 'compact',
      ...(pool == null ? {} : { workerPool: pool }),
    });
    register.render({ rows: data.rows, parentNode: host });
    registerRef.current = register;
    return () => {
      registerRef.current = null;
      register.cleanUp();
    };
  }, [data, poolEnabled]);

  // The account tree is optional because seeding its controller walks every
  // posting: measurable at 1M entries, so the toggle lets visitors isolate
  // register cost. Build time is measured around the real construct+render.
  useEffect(() => {
    const host = treeHostRef.current;
    if (data == null || host == null || !treeEnabled) return;
    const treeStart = performance.now();
    const tree = new AccountTree({
      entries: data.entries,
      currency: 'MYR',
      initialExpansion: 'top-level',
      density: 'compact',
    });
    tree.render(host);
    setTreeBuildMs(performance.now() - treeStart);
    return () => {
      tree.cleanUp();
    };
  }, [data, treeEnabled]);

  // Live rendered-window readout: getRenderedRange() is a plain field read
  // exposed by the register, polled instead of evented (the component has
  // no window-rendered callback). State only updates when the range moved,
  // so idle polling causes zero re-renders.
  useEffect(() => {
    if (data == null) return;
    const interval = window.setInterval(() => {
      const range = registerRef.current?.getRenderedRange();
      setWindowRange((previous) => {
        if (range == null) return previous;
        if (
          previous != null &&
          previous.start === range.start &&
          previous.end === range.end
        ) {
          return previous;
        }
        return { start: range.start, end: range.end };
      });
      if (poolEnabled) {
        const readout = describePool(acquireWorkerPool());
        setPoolReadout((previous) =>
          previous === readout ? previous : readout
        );
      }
    }, STATS_POLL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [data, poolEnabled]);

  // Auto-scroll stress test: jump the smooth-scroll spring to a random row
  // on a fixed cadence. Random targets defeat any locality the row window
  // could exploit, so every tick is a cold window render — the worst case
  // the worker pool exists for. prefers-reduced-motion turns each glide
  // into an instant jump inside the spring itself.
  useEffect(() => {
    if (!stressRunning || data == null) return;
    const interval = window.setInterval(() => {
      const total = data.rows.length;
      if (total === 0) return;
      registerRef.current?.scrollToRow(Math.floor(Math.random() * total), {
        align: 'start',
        behavior: 'smooth',
      });
    }, STRESS_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [stressRunning, data]);

  const scrollToRandomRow = useCallback(() => {
    if (data == null || data.rows.length === 0) return;
    registerRef.current?.scrollToRow(
      Math.floor(Math.random() * data.rows.length),
      { align: 'start', behavior: 'smooth' }
    );
  }, [data]);

  const busy = phase === 'generating' || phase === 'projecting';
  const mountedRows =
    windowRange == null ? null : windowRange.end - windowRange.start;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5">
        <span className="text-muted-foreground text-xs">Workload</span>
        <div className="flex flex-wrap items-center gap-0.5">
          {WORKLOAD_ORDER.map((name) => (
            <Button
              key={name}
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => void generate(name)}
              className={cn(
                'text-muted-foreground font-normal',
                data?.workload === name &&
                  'text-foreground bg-muted font-medium'
              )}
            >
              {name} ({formatCount(WORKLOAD_ENTRY_COUNTS[name])})
            </Button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SwitchPill
            label="Worker pool"
            checked={poolEnabled}
            onCheckedChange={setPoolEnabled}
          />
          <SwitchPill
            label="Account tree"
            checked={treeEnabled}
            onCheckedChange={setTreeEnabled}
          />
        </div>
      </div>

      {phase === 'idle' && (
        <div className="text-muted-foreground rounded-lg border p-4 font-mono text-[13px]">
          Pick a workload to generate it in this tab. Generation is one
          synchronous pass of the seeded generator (it has no incremental API),
          so the tab blocks until it completes — expect a few seconds at
          1,000,000 entries. The register-row projection that follows is
          time-sliced through the cooperative scheduler in 8 ms slices, so the
          page stays responsive for that part. Every number shown is a live
          performance.now() measurement from this session.
        </div>
      )}

      {busy && (
        <div
          className="text-muted-foreground rounded-lg border p-4 font-mono text-[13px]"
          role="status"
        >
          {phase === 'generating'
            ? `Generating ${formatCount(
                WORKLOAD_ENTRY_COUNTS[pendingWorkload ?? 'small']
              )} entries — single synchronous pass, the tab blocks until it finishes…`
            : 'Projecting register rows through the cooperative scheduler (8 ms slices)…'}
        </div>
      )}

      {data != null && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5 font-mono text-xs">
            <span>
              {formatCount(data.entries.length)} entries ·{' '}
              {formatCount(data.accountCount)} accounts ·{' '}
              {formatCount(data.rows.length)} register rows
            </span>
            <span className="text-muted-foreground">
              generate {formatMs(data.timings.generateMs)} · store build{' '}
              {formatMs(data.timings.storeBuildMs)} · projection{' '}
              {formatMs(data.timings.projectionMs)}
              {treeEnabled && treeBuildMs != null
                ? ` · tree build ${formatMs(treeBuildMs)}`
                : ''}
            </span>
          </div>

          <div
            className={cn(
              'grid gap-4',
              treeEnabled && 'md:grid-cols-[minmax(260px,340px)_1fr]'
            )}
          >
            {treeEnabled && (
              <div
                ref={treeHostRef}
                className="demo-container h-[560px] [&>accounts-container]:h-full"
              />
            )}
            <div
              ref={registerHostRef}
              className="demo-container h-[560px] min-w-0 [&>journals-container]:h-full"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-2.5">
            <Button
              variant="outline"
              size="xs"
              onClick={() => setStressRunning((running) => !running)}
            >
              {stressRunning ? <Square size={14} /> : <Play size={14} />}
              {stressRunning ? 'Stop stress scroll' : 'Start stress scroll'}
            </Button>
            <Button variant="outline" size="xs" onClick={scrollToRandomRow}>
              <Shuffle size={14} />
              Random row
            </Button>
            <span className="text-muted-foreground ml-auto font-mono text-xs">
              {windowRange == null || mountedRows == null
                ? `DOM window: — of ${formatCount(data.rows.length)} rows`
                : `DOM window: rows ${formatCount(windowRange.start)}–${formatCount(
                    windowRange.end
                  )} of ${formatCount(data.rows.length)} (${formatCount(
                    mountedRows
                  )} mounted)`}
              {' · '}worker pool: {poolReadout ?? '—'}
            </span>
          </div>

          <p className="text-muted-foreground font-mono text-xs">
            The register shows <code>{REGISTER_ACCOUNT}</code>, the busiest
            generated account. Fixed row heights reduce windowing to arithmetic,
            so the mounted-row count above stays viewport-sized — independent of
            the entry count. The stress scroll retargets the critically-damped
            spring to a random row every {STRESS_INTERVAL_MS} ms — cold windows
            on purpose; with the worker pool on, window HTML renders off the
            main thread and falls back transparently if workers fail.
          </p>
        </>
      )}
    </div>
  );
}
