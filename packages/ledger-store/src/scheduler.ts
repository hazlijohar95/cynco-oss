// Cooperative time-sliced scheduler: runs queued tasks in slices of a fixed
// wall-clock budget (default 8ms — half a 60fps frame, leaving the other
// half for layout and paint), then yields to the event loop so input and
// rendering never starve behind bulk data work.
//
// Deliberately generic: no ledger imports, no DOM/runtime dependencies. The
// yield primitive is `setTimeout(0)` because it is the one deferral that
// exists and behaves the same in browsers, jsdom, Bun, Node, and SSR —
// `requestIdleCallback` is missing in most of those and `queueMicrotask`
// never yields to rendering or IO.
//
// Task shape: a step function `(deadline) => { done, value? }` rather than a
// generator. The explicit deadline argument lets a task adaptively size its
// inner batch on every resume (generators would need `next(deadline)`
// plumbing that TypeScript types poorly), the `{ done, value }` return types
// the completion value cleanly without generator TReturn gymnastics, and a
// plain function keeps the hot loop free of iterator-protocol indirection.

/** Passed to every task step; mirrors the IdleDeadline shape. */
export interface SchedulerDeadline {
  /** Milliseconds left in the current slice budget (never negative). */
  timeRemaining(): number;
}

/**
 * One step's outcome: `done: false` means "call me again" (in this slice if
 * budget remains, otherwise the next one); `done: true` resolves the task's
 * promise with `value`.
 */
export interface SchedulerStep<T> {
  done: boolean;
  value?: T;
}

/**
 * A resumable unit of work. Each call should do a bounded amount of work
 * (ideally checking `deadline.timeRemaining()` to size its inner batch) and
 * report whether the task is finished.
 */
export type SchedulerTask<T> = (
  deadline: SchedulerDeadline
) => SchedulerStep<T>;

/** Counters exposed by `CooperativeScheduler.metrics`. */
export interface SchedulerMetrics {
  /** Tasks run to `done: true` and resolved. */
  tasksCompleted: number;
  /** Slices executed (one slice = one turn of the event loop doing work). */
  slicesRun: number;
  /** Total wall-clock milliseconds spent inside slices. */
  totalElapsedMs: number;
  /**
   * Worst single-slice overrun beyond the budget. A slice can only overrun
   * by the duration of one task step, so a large value here means some step
   * does too much work per call.
   */
  maxSliceOverrunMs: number;
}

/** Options bag for `createCooperativeScheduler`. */
export interface SchedulerOptions {
  /** Wall-clock budget per slice in milliseconds. Defaults to 8. */
  budgetMs?: number;
  /** Maximum tasks queued at once; excess schedules reject. Defaults to 256. */
  maxQueue?: number;
}

/** The scheduler handle returned by `createCooperativeScheduler`. */
export interface CooperativeScheduler {
  /**
   * Queues a task (FIFO: earlier tasks run to completion before later ones
   * start) and resolves with its completion value. Rejects immediately with
   * `SchedulerQueueFullError` when the queue is at capacity, and with
   * `SchedulerAbortedError` when the scheduler was aborted.
   */
  schedule<T>(task: SchedulerTask<T>): Promise<T>;
  /**
   * Permanently stops the scheduler: every pending task's promise rejects
   * with `SchedulerAbortedError`, and all future `schedule` calls reject the
   * same way. Terminal by design — callers wanting to resume create a fresh
   * scheduler.
   */
  abort(reason?: string): void;
  /** A point-in-time copy of the counters; safe to retain. */
  metrics(): SchedulerMetrics;
}

/** Rejection value for tasks pending when `abort` was called (and after). */
export class SchedulerAbortedError extends Error {
  constructor(reason?: string) {
    super(
      reason == null ? 'Scheduler aborted' : `Scheduler aborted: ${reason}`
    );
    this.name = 'SchedulerAbortedError';
  }
}

/** Rejection value for `schedule` calls beyond the queue capacity. */
export class SchedulerQueueFullError extends Error {
  constructor(maxQueue: number) {
    super(`Scheduler queue is full (maxQueue=${maxQueue})`);
    this.name = 'SchedulerQueueFullError';
  }
}

const DEFAULT_BUDGET_MS = 8;
const DEFAULT_MAX_QUEUE = 256;

// Monotonic-ish millisecond clock. `performance.now()` exists in browsers,
// Bun, Node, and jsdom; Date.now() is the SSR-safe fallback for exotic
// runtimes that lack it.
function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

// One queued task with its promise plumbing. `resolve` is typed as unknown
// because the queue is heterogeneous; `schedule` restores the per-task type.
interface QueuedTask {
  step: SchedulerTask<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * Creates an independent cooperative scheduler. See the file-level comment
 * for the design rationale (slice budget, yield primitive, task shape).
 */
export function createCooperativeScheduler(
  options: SchedulerOptions = {}
): CooperativeScheduler {
  const budgetMs = Math.max(0, options.budgetMs ?? DEFAULT_BUDGET_MS);
  const maxQueue = Math.max(1, options.maxQueue ?? DEFAULT_MAX_QUEUE);

  const queue: QueuedTask[] = [];
  let aborted = false;
  let sliceScheduled = false;
  let tasksCompleted = 0;
  let slicesRun = 0;
  let totalElapsedMs = 0;
  let maxSliceOverrunMs = 0;

  // Defers the next slice with the portable yield primitive. Guarded so a
  // burst of schedule() calls arms exactly one timer.
  function armSlice(): void {
    if (sliceScheduled || aborted) {
      return;
    }
    sliceScheduled = true;
    setTimeout(runSlice, 0);
  }

  // Runs task steps until the budget is spent or the queue drains, then
  // re-arms itself if work remains. The head task runs to completion before
  // the next starts, which is what makes completion order FIFO.
  function runSlice(): void {
    sliceScheduled = false;
    if (aborted) {
      return;
    }
    slicesRun += 1;
    const sliceStart = nowMs();
    const deadline: SchedulerDeadline = {
      timeRemaining: () => Math.max(0, budgetMs - (nowMs() - sliceStart)),
    };
    while (queue.length > 0) {
      const task = queue[0];
      let step: SchedulerStep<unknown> | null = null;
      try {
        step = task.step(deadline);
      } catch (error) {
        // A throwing step fails only its own task; the scheduler keeps
        // draining the rest of the queue.
        queue.shift();
        task.reject(error);
      }
      if (aborted) {
        // A step called abort(): pending promises were already rejected and
        // the queue cleared; stop immediately.
        break;
      }
      if (step != null && step.done) {
        queue.shift();
        tasksCompleted += 1;
        task.resolve(step.value);
      }
      if (nowMs() - sliceStart >= budgetMs) {
        break;
      }
    }
    const elapsed = nowMs() - sliceStart;
    totalElapsedMs += elapsed;
    if (elapsed - budgetMs > maxSliceOverrunMs) {
      maxSliceOverrunMs = elapsed - budgetMs;
    }
    if (queue.length > 0) {
      armSlice();
    }
  }

  return {
    schedule<T>(task: SchedulerTask<T>): Promise<T> {
      if (aborted) {
        return Promise.reject(
          new SchedulerAbortedError('scheduler already aborted')
        );
      }
      if (queue.length >= maxQueue) {
        return Promise.reject(new SchedulerQueueFullError(maxQueue));
      }
      return new Promise<T>((resolve, reject) => {
        queue.push({
          step: task as SchedulerTask<unknown>,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        armSlice();
      });
    },

    abort(reason?: string): void {
      if (aborted) {
        return;
      }
      aborted = true;
      const error = new SchedulerAbortedError(reason);
      // Drain into a local list first so a rejection handler that calls
      // schedule() synchronously cannot observe a half-cleared queue.
      const pending = queue.splice(0, queue.length);
      for (const task of pending) {
        task.reject(error);
      }
    },

    metrics(): SchedulerMetrics {
      return { tasksCompleted, slicesRun, totalElapsedMs, maxSliceOverrunMs };
    },
  };
}
