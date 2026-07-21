import LRUMapPkg from 'lru_map';

import { renderRegisterWindowHTML } from '../renderers/RegisterRenderer';
import type {
  AmountFormat,
  BookPostingRef,
  ReconciliationMatch,
  RegisterFilter,
  RegisterGroupBy,
  RegisterRowData,
  RowRange,
  StatementLine,
} from '../types';
import {
  proposeMatches,
  type ProposeMatchesOptions,
} from '../utils/proposeMatches';
import type {
  WorkerPoolOptions,
  WorkerRequest,
  WorkerRequestId,
  WorkerResponse,
  WorkerStats,
} from './types';

export class WorkerPoolTerminatedError extends Error {
  constructor() {
    super('WorkerPoolManager: operation canceled because the pool terminated');
  }
}

interface ManagedWorker {
  worker: Worker;
  /** Request currently executing on this worker, if any. */
  requestId: WorkerRequestId | undefined;
  initialized: boolean;
}

// Omit over a union collapses to common members; distribute it so each
// request variant keeps its own payload fields sans `id`.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

type WorkerRequestBody = DistributiveOmit<WorkerRequest, 'id'>;

interface PoolTask {
  id: WorkerRequestId;
  request: WorkerRequest;
  dedupeKey: string | null;
  /** Main-thread equivalent of the request, run when workers are unusable. */
  fallback(): unknown;
  resolve(result: unknown): void;
  reject(error: unknown): void;
  requestStart: number;
}

export interface RenderRegisterWindowProps {
  rows: readonly RegisterRowData[];
  range: RowRange;
  /**
   * Absolute entry index of `rows[0]` when the caller sends only the flat
   * window's slice instead of the whole dataset; see
   * {@link RegisterWindowRequest.rowsOffset}. Default 0 (full rows).
   */
  rowsOffset?: number;
  selectedIndex: number | null;
  /** Sorted selected entry indexes (range selection); wins over selectedIndex. */
  selectedIndexes?: readonly number[] | null;
  /** Period grouping; the worker rebuilds the row model deterministically. */
  groupBy?: RegisterGroupBy;
  /** Row id prefix for aria-activedescendant; see RegisterWindowRequest. */
  idPrefix?: string | null;
  /** Projection-level row filter; see RegisterWindowRequest.filter. */
  filter?: RegisterFilter | null;
  /** Amount separators/grouping; see RegisterWindowRequest.amountFormat. */
  amountFormat?: AmountFormat | null;
  /**
   * Stable identity for this exact input (e.g. `instance:rowsVersion:start:
   * end:selected`). Enables dedupe of in-flight identical requests and the
   * LRU result cache. Omit to always compute fresh.
   */
  cacheKey?: string;
}

export interface ProposeMatchesPoolProps {
  statementLines: readonly StatementLine[];
  postings: readonly BookPostingRef[];
  options?: ProposeMatchesOptions;
  /** See {@link RenderRegisterWindowProps.cacheKey}. */
  cacheKey?: string;
}

const DEFAULT_RESULT_CACHE_SIZE = 200;

// Off-main-thread computation pool for @cynco/journals: N workers, a FIFO task
// queue with dedupe-by-key (identical in-flight requests share one job), an
// LRU result cache, stats subscribers, and — the load-bearing guarantee — a
// transparent main-thread fallback. Every job carries its own fallback
// closure running the same DOM-free functions the worker runs, so callers
// get a resolved promise whether workers exist, fail to boot, or die
// mid-job. Workers never being available is a performance regression, never
// a correctness one.
export class WorkerPoolManager {
  private workers: ManagedWorker[] = [];
  private queuedTasks: PoolTask[] = [];
  private activeTaskById = new Map<WorkerRequestId, PoolTask>();
  private promiseByDedupeKey = new Map<string, Promise<unknown>>();
  private resultCache: LRUMapPkg.LRUMap<string, unknown>;
  private statSubscribers = new Set<(stats: WorkerStats) => unknown>();

  private initialized: Promise<void> | boolean = false;
  private workersFailed = false;
  private nextRequestId = 0;
  private _queuedBroadcast: ReturnType<typeof setTimeout> | undefined;
  // Incremented on terminate so async lifecycle work can identify stale results.
  private lifecycleGeneration = 0;

  constructor(private options: WorkerPoolOptions) {
    this.resultCache = new LRUMapPkg.LRUMap(
      options.resultCacheSize ?? DEFAULT_RESULT_CACHE_SIZE
    );
    this.queueInitialization();
  }

  public isWorkingPool(): boolean {
    return !this.workersFailed;
  }

  public isInitialized(): boolean {
    return this.initialized === true;
  }

  public renderRegisterWindow({
    rows,
    range,
    rowsOffset,
    selectedIndex,
    selectedIndexes,
    groupBy,
    idPrefix,
    filter,
    amountFormat,
    cacheKey,
  }: RenderRegisterWindowProps): Promise<string> {
    return this.submit({
      request: {
        type: 'register-window',
        rows,
        range,
        rowsOffset,
        selectedIndex,
        selectedIndexes,
        groupBy,
        idPrefix,
        filter,
        amountFormat,
      },
      dedupeKey: cacheKey != null ? `register-window:${cacheKey}` : null,
      // Same selection resolution as handleWorkerRequest so worker and
      // fallback bytes can never diverge.
      fallback: () =>
        renderRegisterWindowHTML(
          rows,
          range,
          selectedIndexes != null ? new Set(selectedIndexes) : selectedIndex,
          groupBy,
          idPrefix ?? undefined,
          filter,
          rowsOffset,
          amountFormat ?? undefined
        ),
    }) as Promise<string>;
  }

  public proposeMatches({
    statementLines,
    postings,
    options,
    cacheKey,
  }: ProposeMatchesPoolProps): Promise<ReconciliationMatch[]> {
    return this.submit({
      request: {
        type: 'propose-matches',
        statementLines,
        postings,
        options,
      },
      dedupeKey: cacheKey != null ? `propose-matches:${cacheKey}` : null,
      fallback: () => proposeMatches(statementLines, postings, options),
    }) as Promise<ReconciliationMatch[]>;
  }

  public subscribeToStatChanges(
    callback: (stats: WorkerStats) => unknown
  ): () => void {
    this.statSubscribers.add(callback);
    callback(this.getStats());
    return () => {
      this.statSubscribers.delete(callback);
    };
  }

  public getStats(): WorkerStats {
    return {
      managerState: (() => {
        if (this.initialized === false) {
          return 'waiting';
        }
        if (this.initialized !== true) {
          return 'initializing';
        }
        return 'initialized';
      })(),
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter((w) => w.requestId != null).length,
      queuedTasks: this.queuedTasks.length,
      activeTasks: this.activeTaskById.size,
      cacheSize: this.resultCache.size,
      workersFailed: this.workersFailed,
    };
  }

  public async initialize(): Promise<void> {
    if (this.initialized === true) {
      return;
    }
    if (this.initialized !== false) {
      return this.initialized;
    }
    const { lifecycleGeneration } = this;
    this.initialized = (async () => {
      try {
        await this.initializeWorkers();
        if (!this.isCurrentLifecycle(lifecycleGeneration)) {
          this.terminateWorkers();
          return;
        }
        this.initialized = true;
      } catch (error) {
        if (!this.isCurrentLifecycle(lifecycleGeneration)) {
          return;
        }
        // Workers are an optimization: construction/handshake failures flip
        // the pool into main-thread mode instead of surfacing errors.
        console.error('WorkerPoolManager: worker startup failed', error);
        this.terminateWorkers();
        this.initialized = true;
        this.workersFailed = true;
      } finally {
        if (this.isCurrentLifecycle(lifecycleGeneration)) {
          this.drainQueue();
          this.queueBroadcastStateChanges();
        }
      }
    })();
    this.queueBroadcastStateChanges();
    return this.initialized;
  }

  public terminate(): void {
    this.lifecycleGeneration++;
    const error = new WorkerPoolTerminatedError();
    for (const task of this.activeTaskById.values()) {
      task.reject(error);
    }
    for (const task of this.queuedTasks) {
      task.reject(error);
    }
    this.queuedTasks.length = 0;
    this.activeTaskById.clear();
    this.promiseByDedupeKey.clear();
    this.terminateWorkers();
    this.resultCache.clear();
    this.initialized = false;
    this.workersFailed = false;
    this.queueBroadcastStateChanges();
  }

  private submit(props: {
    request: WorkerRequestBody;
    dedupeKey: string | null;
    fallback(): unknown;
  }): Promise<unknown> {
    const { dedupeKey, fallback } = props;
    if (dedupeKey != null) {
      const cached = this.resultCache.get(dedupeKey);
      if (cached !== undefined) {
        return Promise.resolve(cached);
      }
      const inFlight = this.promiseByDedupeKey.get(dedupeKey);
      if (inFlight != null) {
        return inFlight;
      }
    }

    // Failed pool: run the main-thread equivalent immediately (still cache —
    // scroll revisits the same windows either way).
    if (this.workersFailed) {
      const result = fallback();
      if (dedupeKey != null) {
        this.resultCache.set(dedupeKey, result);
      }
      return Promise.resolve(result);
    }

    const id = this.generateRequestId();
    const request = { ...props.request, id } as WorkerRequest;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.queuedTasks.push({
        id,
        request,
        dedupeKey,
        fallback,
        resolve: (result) => {
          if (dedupeKey != null) {
            this.resultCache.set(dedupeKey, result);
            this.promiseByDedupeKey.delete(dedupeKey);
          }
          resolve(result);
        },
        reject: (error) => {
          if (dedupeKey != null) {
            this.promiseByDedupeKey.delete(dedupeKey);
          }
          reject(error);
        },
        requestStart: Date.now(),
      });
    });
    if (dedupeKey != null) {
      this.promiseByDedupeKey.set(dedupeKey, promise);
    }
    if (this.initialized === false) {
      this.queueInitialization();
    }
    this.drainQueue();
    this.queueBroadcastStateChanges();
    return promise;
  }

  private drainQueue(): void {
    if (this.initialized !== true) {
      return;
    }
    // Workers became unusable after boot: flush everything through fallbacks.
    if (this.workersFailed) {
      const tasks = this.queuedTasks.splice(0, this.queuedTasks.length);
      for (const task of tasks) {
        this.resolveViaFallback(task);
      }
      return;
    }
    while (this.queuedTasks.length > 0) {
      const availableWorker = this.workers.find(
        (managed) => managed.initialized && managed.requestId == null
      );
      if (availableWorker == null) {
        break;
      }
      const task = this.queuedTasks.shift();
      if (task == null) {
        break;
      }
      availableWorker.requestId = task.id;
      this.activeTaskById.set(task.id, task);
      availableWorker.worker.postMessage(task.request);
    }
    this.queueBroadcastStateChanges();
  }

  private async initializeWorkers(): Promise<void> {
    const poolSize = this.options.poolSize ?? getDefaultPoolSize();
    const handshakes: Promise<void>[] = [];
    for (let i = 0; i < poolSize; i++) {
      const worker = this.options.workerFactory();
      const managedWorker: ManagedWorker = {
        worker,
        requestId: undefined,
        initialized: false,
      };
      worker.addEventListener(
        'message',
        (event: MessageEvent<WorkerResponse>) => {
          this.handleWorkerMessage(managedWorker, event.data);
        }
      );
      worker.addEventListener('error', (event) => {
        this.handleWorkerFailure(event);
      });
      this.workers.push(managedWorker);
      handshakes.push(
        new Promise<void>((resolve, reject) => {
          const id = this.generateRequestId();
          this.activeTaskById.set(id, {
            id,
            request: { type: 'initialize', id },
            dedupeKey: null,
            fallback: () => undefined,
            resolve: () => {
              managedWorker.initialized = true;
              resolve();
            },
            reject,
            requestStart: Date.now(),
          });
          managedWorker.worker.postMessage({ type: 'initialize', id });
        })
      );
    }
    await Promise.all(handshakes);
  }

  private handleWorkerMessage(
    managedWorker: ManagedWorker,
    response: WorkerResponse
  ): void {
    const task = this.activeTaskById.get(response.id);
    if (task == null) {
      // Late response for a task the pool already gave up on (terminate).
      return;
    }
    this.activeTaskById.delete(response.id);
    if (managedWorker.requestId === response.id) {
      managedWorker.requestId = undefined;
    }
    if (response.type === 'error') {
      // A single failed job is not a failed pool: recompute on the main
      // thread so the caller never sees the worker error.
      console.error(
        `WorkerPoolManager: worker task failed (${task.request.type}): ${response.error}`
      );
      this.resolveViaFallback(task);
    } else {
      switch (response.requestType) {
        case 'initialize':
          task.resolve(undefined);
          break;
        case 'register-window':
          task.resolve(response.html);
          break;
        case 'propose-matches':
          task.resolve(response.matches);
          break;
      }
    }
    this.drainQueue();
  }

  // A worker-level error (script failed to load, worker crashed) marks the
  // whole pool failed: every queued and future job runs its fallback.
  private handleWorkerFailure(event: unknown): void {
    if (this.workersFailed) {
      return;
    }
    console.error('WorkerPoolManager: worker failed; falling back', event);
    this.workersFailed = true;
    const active = [...this.activeTaskById.values()];
    this.activeTaskById.clear();
    for (const task of active) {
      if (task.request.type === 'initialize') {
        task.resolve(undefined);
      } else {
        this.resolveViaFallback(task);
      }
    }
    for (const managed of this.workers) {
      managed.initialized = true;
      managed.requestId = undefined;
    }
    this.drainQueue();
    this.queueBroadcastStateChanges();
  }

  private resolveViaFallback(task: PoolTask): void {
    try {
      task.resolve(task.fallback());
    } catch (error) {
      task.reject(error);
    }
  }

  private queueInitialization(): void {
    void this.initialize().catch((error) => {
      console.error(error);
    });
  }

  private terminateWorkers(): void {
    for (const managedWorker of this.workers) {
      managedWorker.worker.terminate();
    }
    this.workers.length = 0;
  }

  private isCurrentLifecycle(lifecycleGeneration: number): boolean {
    return this.lifecycleGeneration === lifecycleGeneration;
  }

  private generateRequestId(): WorkerRequestId {
    return `journals-task-${++this.nextRequestId}`;
  }

  // Stat broadcasts are debounced to one macrotask; rAF is preferred in the
  // browser but this also runs in Node/bun (SSR, tests) where rAF may not
  // exist.
  private queueBroadcastStateChanges(): void {
    if (this._queuedBroadcast != null || this.statSubscribers.size === 0) {
      return;
    }
    this._queuedBroadcast = setTimeout(() => {
      this._queuedBroadcast = undefined;
      const stats = this.getStats();
      for (const callback of this.statSubscribers) {
        callback(stats);
      }
    }, 0);
  }
}

// Register windows and proposals are bursty; two workers cover interleaved
// scroll + reconcile without hogging cores on small machines.
function getDefaultPoolSize(): number {
  const cores =
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(2, cores));
}
