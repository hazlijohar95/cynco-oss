import { renderRegisterRowsHTML } from '../renderers/RegisterRenderer';
import { proposeMatches } from '../utils/proposeMatches';
import type { WorkerRequest, WorkerResponse } from './types';

// Reset legacy RegExp last-match state so it cannot keep a rendered source
// string alive after a job completes (the renderers run regex replaces over
// caller strings; RegExp.lastMatch would otherwise pin the last one).
const EMPTY_REGEXP = /(?:)/;

/**
 * The worker's entire brain as a pure synchronous function: request in,
 * response out, no worker globals touched. `worker.ts` is a thin
 * postMessage shell around this, which lets tests exercise the real
 * protocol without a Worker (jsdom has none) and lets the pool manager run
 * the identical code as its main-thread fallback.
 */
export function handleWorkerRequest(request: WorkerRequest): WorkerResponse {
  try {
    switch (request.type) {
      case 'initialize':
        return {
          type: 'success',
          requestType: 'initialize',
          id: request.id,
          sentAt: Date.now(),
        };
      case 'register-window':
        return {
          type: 'success',
          requestType: 'register-window',
          id: request.id,
          html: renderRegisterRowsHTML(
            request.rows,
            request.range,
            request.selectedIndex
          ),
          sentAt: Date.now(),
        };
      case 'propose-matches':
        return {
          type: 'success',
          requestType: 'propose-matches',
          id: request.id,
          matches: proposeMatches(
            request.statementLines,
            request.postings,
            request.options
          ),
          sentAt: Date.now(),
        };
      default:
        throw new Error(
          `Unknown request type: ${(request as WorkerRequest).type}`
        );
    }
  } catch (error) {
    return {
      type: 'error',
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
  } finally {
    EMPTY_REGEXP.exec('');
  }
}
