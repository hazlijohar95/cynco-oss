import { handleWorkerRequest } from '../src/worker/handleWorkerRequest';
import type { WorkerRequest } from '../src/worker/types';

export type MockWorkerBehavior = 'ok' | 'error-response' | 'error-event';

// jsdom has no Worker, so pool tests mock the postMessage boundary and run
// the REAL worker module's request handler behind it — the protocol under
// test is the actual protocol, only the transport is fake. Responses are
// delivered on a macrotask like a real worker's, so queue/dedupe timing is
// exercised honestly.
export class MockWorker {
  postedRequests: WorkerRequest[] = [];
  terminated = false;
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(private behavior: MockWorkerBehavior = 'ok') {}

  addEventListener(type: string, callback: (event: unknown) => void): void {
    let set = this.listeners.get(type);
    if (set == null) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(callback);
  }

  removeEventListener(type: string, callback: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(callback);
  }

  postMessage(request: WorkerRequest): void {
    this.postedRequests.push(request);
    setTimeout(() => {
      if (this.terminated) {
        return;
      }
      if (this.behavior === 'error-event') {
        this.dispatch('error', { message: 'mock worker crashed' });
        return;
      }
      const response =
        this.behavior === 'error-response' && request.type !== 'initialize'
          ? {
              type: 'error' as const,
              id: request.id,
              error: 'mock task failure',
            }
          : handleWorkerRequest(request);
      this.dispatch('message', { data: response });
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }

  private dispatch(type: string, event: unknown): void {
    for (const callback of this.listeners.get(type) ?? []) {
      callback(event);
    }
  }
}

/**
 * Worker-typed factory over MockWorker plus access to the created
 * instances, so tests can count real postMessage traffic.
 */
export function createMockWorkerFactory(behavior: MockWorkerBehavior = 'ok'): {
  factory(): Worker;
  instances: MockWorker[];
  totalTaskPosts(): number;
} {
  const instances: MockWorker[] = [];
  return {
    factory(): Worker {
      const worker = new MockWorker(behavior);
      instances.push(worker);
      return worker as unknown as Worker;
    },
    instances,
    // Initialize handshakes excluded: only real task traffic counts.
    totalTaskPosts(): number {
      let count = 0;
      for (const worker of instances) {
        count += worker.postedRequests.filter(
          (request) => request.type !== 'initialize'
        ).length;
      }
      return count;
    },
  };
}
