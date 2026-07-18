import type { WorkerPoolOptions } from './types';
import { WorkerPoolManager } from './WorkerPoolManager';

let workerPoolSingleton: WorkerPoolManager | undefined;

// One pool per page is almost always right: worker count is a global
// resource decision, and the LRU cache works best shared. First caller's
// options win; later calls reuse the existing pool.
export function getOrCreateWorkerPoolSingleton(
  poolOptions: WorkerPoolOptions
): WorkerPoolManager {
  workerPoolSingleton ??= new WorkerPoolManager(poolOptions);
  return workerPoolSingleton;
}

export function terminateWorkerPoolSingleton(): void {
  if (workerPoolSingleton == null) {
    return;
  }
  workerPoolSingleton.terminate();
  workerPoolSingleton = undefined;
}
