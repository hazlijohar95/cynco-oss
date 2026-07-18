import type {
  BookPostingRef,
  ReconciliationMatch,
  RegisterRowData,
  RowRange,
  StatementLine,
} from '../types';
import type { ProposeMatchesOptions } from '../utils/proposeMatches';

export type WorkerRequestId = string;

// --- Requests (main thread -> worker) ---------------------------------------

export interface InitializeWorkerRequest {
  type: 'initialize';
  id: WorkerRequestId;
}

/**
 * Render one virtualized register window off the main thread. Rows survive
 * structured clone (plain data plus Map running balances), and the renderer
 * is a DOM-free string builder, so the worker returns exactly the HTML the
 * sync path would produce.
 */
export interface RegisterWindowRequest {
  type: 'register-window';
  id: WorkerRequestId;
  rows: readonly RegisterRowData[];
  range: RowRange;
  selectedIndex: number | null;
}

/** Run the deterministic reconciliation proposal engine off the main thread. */
export interface ProposeMatchesRequest {
  type: 'propose-matches';
  id: WorkerRequestId;
  statementLines: readonly StatementLine[];
  postings: readonly BookPostingRef[];
  options?: ProposeMatchesOptions;
}

export type WorkerRequest =
  | InitializeWorkerRequest
  | RegisterWindowRequest
  | ProposeMatchesRequest;

// --- Responses (worker -> main thread) --------------------------------------

export interface InitializeSuccessResponse {
  type: 'success';
  requestType: 'initialize';
  id: WorkerRequestId;
  sentAt: number;
}

export interface RegisterWindowSuccessResponse {
  type: 'success';
  requestType: 'register-window';
  id: WorkerRequestId;
  html: string;
  sentAt: number;
}

export interface ProposeMatchesSuccessResponse {
  type: 'success';
  requestType: 'propose-matches';
  id: WorkerRequestId;
  matches: ReconciliationMatch[];
  sentAt: number;
}

export interface WorkerErrorResponse {
  type: 'error';
  id: WorkerRequestId;
  error: string;
  stack?: string;
}

export type WorkerResponse =
  | InitializeSuccessResponse
  | RegisterWindowSuccessResponse
  | ProposeMatchesSuccessResponse
  | WorkerErrorResponse;

// --- Pool configuration -------------------------------------------------------

export interface WorkerPoolOptions {
  /**
   * Creates one Worker. Required because worker URL resolution is a
   * bundler concern: pass e.g. Vite's `?worker` constructor for
   * `@cynco/journals/worker/worker-portable.js`, or
   * `() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`.
   */
  workerFactory(): Worker;
  /**
   * Number of workers. Default `min(2, navigator.hardwareConcurrency)`
   * (register windows and proposals are bursty, not sustained — two workers
   * cover interleaved scroll + reconcile without hogging cores).
   */
  poolSize?: number;
  /** LRU entries kept in the result cache. Default 200. */
  resultCacheSize?: number;
}

export interface WorkerStats {
  managerState: 'waiting' | 'initializing' | 'initialized';
  totalWorkers: number;
  busyWorkers: number;
  queuedTasks: number;
  activeTasks: number;
  cacheSize: number;
  /** True once worker construction/initialization failed; every job then
   * runs its main-thread fallback transparently. */
  workersFailed: boolean;
}
