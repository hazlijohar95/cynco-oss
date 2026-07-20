import { getOrCreateWorkerPoolSingleton } from '@cynco/journals/worker';
import type { WorkerPoolManager } from '@cynco/journals/worker';

// Lazily creates (or reuses) the page-wide worker pool. Worker construction
// is a bundler concern, so the factory points at the local journals-worker
// entry; any synchronous failure (no module-worker support) returns null
// and the register simply runs its main-thread path. Failures AFTER
// construction are handled inside the pool itself — every job falls back to
// the main thread transparently.
export function acquireWorkerPool(): WorkerPoolManager | null {
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

// Pool state for the stats line, as a comparable string so the poll only
// re-renders when something actually changed. `workersFailed` means every
// window render silently ran on the main thread — worth surfacing, since
// the whole point of the toggle is to compare the two paths.
export function describePool(pool: WorkerPoolManager | null): string {
  if (pool == null) {
    return 'unavailable — main-thread fallback';
  }
  const stats = pool.getStats();
  if (stats.workersFailed) {
    return 'workers failed — main-thread fallback';
  }
  return `${String(stats.totalWorkers)} workers · ${String(stats.busyWorkers)} busy`;
}
