import { describe, expect, test } from 'bun:test';

import { renderRegisterRowsHTML } from '../src/renderers/RegisterRenderer';
import { proposeMatches } from '../src/utils/proposeMatches';
import { handleWorkerRequest } from '../src/worker/handleWorkerRequest';
import type { WorkerRequest } from '../src/worker/types';
import { makeBookPosting, makeRows, makeStatementLine } from './domHarness';

// The worker entry is a one-line postMessage shell around
// handleWorkerRequest, so testing the handler tests the real protocol.
describe('worker protocol', () => {
  test('initialize acknowledges with a success response', () => {
    const response = handleWorkerRequest({ type: 'initialize', id: 't1' });
    expect(response).toMatchObject({
      type: 'success',
      requestType: 'initialize',
      id: 't1',
    });
  });

  test('register-window returns byte-identical HTML to the sync renderer', () => {
    const rows = makeRows(50);
    const range = { start: 10, end: 30 };
    const response = handleWorkerRequest({
      type: 'register-window',
      id: 't2',
      rows,
      range,
      selectedIndex: 12,
    });
    if (
      response.type !== 'success' ||
      response.requestType !== 'register-window'
    ) {
      throw new Error('expected register-window success');
    }
    expect(response.html).toBe(renderRegisterRowsHTML(rows, range, 12));
    expect(response.html).toContain('data-row-index="10"');
    expect(response.html).toContain("data-row-selected='true'");
  });

  test('propose-matches returns the same matches as a direct engine call', () => {
    const statementLines = [
      makeStatementLine({ id: 's1', date: '2026-07-02', amount: 15_000 }),
      makeStatementLine({ id: 's2', date: '2026-07-05', amount: 9_000 }),
    ];
    const postings = [
      makeBookPosting({ entryId: 'e1', date: '2026-07-02', amount: 15_000 }),
      makeBookPosting({ entryId: 'e2', date: '2026-07-05', amount: 5_000 }),
      makeBookPosting({ entryId: 'e3', date: '2026-07-05', amount: 4_000 }),
    ];
    const response = handleWorkerRequest({
      type: 'propose-matches',
      id: 't3',
      statementLines,
      postings,
      options: { maxGroupSize: 3 },
    });
    if (
      response.type !== 'success' ||
      response.requestType !== 'propose-matches'
    ) {
      throw new Error('expected propose-matches success');
    }
    expect(response.matches).toEqual(
      proposeMatches(statementLines, postings, { maxGroupSize: 3 })
    );
    expect(response.matches.map((match) => match.kind)).toEqual([
      'exact',
      'sum',
    ]);
  });

  test('unknown request types produce an error response, never a throw', () => {
    const response = handleWorkerRequest({
      type: 'nonsense',
      id: 't4',
    } as unknown as WorkerRequest);
    expect(response).toMatchObject({ type: 'error', id: 't4' });
    if (response.type !== 'error') {
      throw new Error('expected error');
    }
    expect(response.error).toContain('Unknown request type');
  });
});
