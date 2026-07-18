import { handleWorkerRequest } from './handleWorkerRequest';
import type { WorkerRequest } from './types';

// Worker entry: a thin postMessage shell around the pure request handler.
// Built as its own tsdown entry (dist/worker/worker.js) so bundlers can
// target it with `new Worker(new URL(...))`; worker-portable.js is the
// fully-bundled variant for bundlers that cannot follow package imports
// inside workers.

self.addEventListener('error', (event) => {
  console.error('[Journals Worker] Unhandled error:', event.error);
});

// Handle incoming messages from the main thread
self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  postMessage(handleWorkerRequest(event.data));
});
