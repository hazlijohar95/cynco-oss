import { describe, expect, test } from 'bun:test';

import {
  renderRegisterRowsHTML,
  renderRegisterVirtualRowsHTML,
  renderRegisterWindowHTML,
} from '../src/renderers/RegisterRenderer';
import type { RegisterFilter } from '../src/types';
import { buildFilteredRegisterRowModel } from '../src/utils/buildFilteredRegisterRowModel';
import { buildRegisterRowModel } from '../src/utils/buildRegisterRowModel';
import { computeRegisterFilterMatches } from '../src/utils/computeRegisterFilterMatches';
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

  test('grouped register-window returns byte-identical HTML to the sync virtual-rows renderer', () => {
    // makeRows shares one date, so vary months to force real group
    // boundaries inside the requested window.
    const rows = makeRows(60).map((row, index) => ({
      ...row,
      entry: {
        ...row.entry,
        date: `2026-${String(Math.floor(index / 20) + 1).padStart(2, '0')}-10`,
      },
    }));
    const model = buildRegisterRowModel(rows, 'month');
    // Model-index space: covers the tail of month 1, all of month 2's
    // header, and the head of month 2's entries.
    const range = { start: 15, end: 30 };
    const selectedIndexes = [16, 17, 21];
    const response = handleWorkerRequest({
      type: 'register-window',
      id: 't2g',
      rows,
      range,
      selectedIndex: 21,
      selectedIndexes,
      groupBy: 'month',
    });
    if (
      response.type !== 'success' ||
      response.requestType !== 'register-window'
    ) {
      throw new Error('expected register-window success');
    }
    expect(response.html).toBe(
      renderRegisterVirtualRowsHTML(model, range, new Set(selectedIndexes))
    );
    expect(response.html).toContain('data-group-row');
    expect(response.html).toContain('data-group-key="2026-02"');
    expect(response.html).toContain("data-row-selected='true'");
  });

  test('flat register-window accepts just the window slice with rowsOffset, byte-identical to full rows', () => {
    const rows = makeRows(200);
    const range = { start: 120, end: 150 };
    // Full-dataset request: the pre-slice protocol shape, still supported.
    const fullResponse = handleWorkerRequest({
      type: 'register-window',
      id: 't2s-full',
      rows,
      range,
      selectedIndex: 130,
      selectedIndexes: [125, 130],
      idPrefix: 'wp-slice',
    });
    // Sliced request: only the window's rows cross the protocol; rowsOffset
    // restores absolute entry indexes so every index-derived byte matches.
    const slicedResponse = handleWorkerRequest({
      type: 'register-window',
      id: 't2s-sliced',
      rows: rows.slice(range.start, range.end),
      range,
      rowsOffset: range.start,
      selectedIndex: 130,
      selectedIndexes: [125, 130],
      idPrefix: 'wp-slice',
    });
    if (
      fullResponse.type !== 'success' ||
      fullResponse.requestType !== 'register-window' ||
      slicedResponse.type !== 'success' ||
      slicedResponse.requestType !== 'register-window'
    ) {
      throw new Error('expected register-window successes');
    }
    expect(slicedResponse.html).toBe(fullResponse.html);
    expect(slicedResponse.html).toBe(
      renderRegisterRowsHTML(rows, range, new Set([125, 130]), 'wp-slice')
    );
    // Absolute-index bytes survive the slice: data-row-index, ids,
    // aria-rowindex, and selection membership all stay in dataset space.
    expect(slicedResponse.html).toContain('data-row-index="120"');
    expect(slicedResponse.html).toContain('id="wp-slice-row-149"');
    expect(slicedResponse.html).toContain('aria-rowindex="121"');
    expect(slicedResponse.html).toContain("data-row-selected='true'");
  });

  test('register-window threads idPrefix so worker row ids match the sync renderer byte for byte', () => {
    const rows = makeRows(20);
    const range = { start: 0, end: 10 };
    const response = handleWorkerRequest({
      type: 'register-window',
      id: 't2i',
      rows,
      range,
      selectedIndex: null,
      idPrefix: 'wp-instance',
    });
    if (
      response.type !== 'success' ||
      response.requestType !== 'register-window'
    ) {
      throw new Error('expected register-window success');
    }
    expect(response.html).toBe(
      renderRegisterRowsHTML(rows, range, null, 'wp-instance')
    );
    expect(response.html).toContain('id="wp-instance-row-0"');
    expect(response.html).toContain('role="row"');
    expect(response.html).toContain('aria-rowindex="1"');
  });

  test('filtered register-window HTML is byte-identical to the sync filtered renderer', () => {
    const rows = makeRows(30);
    const filter: RegisterFilter = { query: 'payee 1' }; // 1, 10..19.
    const model = buildFilteredRegisterRowModel(
      rows,
      'none',
      computeRegisterFilterMatches(rows, filter)
    );
    const range = { start: 0, end: model.length };
    const response = handleWorkerRequest({
      type: 'register-window',
      id: 't2f',
      rows,
      range,
      selectedIndex: 10,
      idPrefix: 'wp-filter',
      filter,
    });
    if (
      response.type !== 'success' ||
      response.requestType !== 'register-window'
    ) {
      throw new Error('expected register-window success');
    }
    // Byte parity against both sync entry points: the shared window
    // renderer AND the model+virtual-rows path the client uses.
    expect(response.html).toBe(
      renderRegisterWindowHTML(rows, range, 10, 'none', 'wp-filter', filter)
    );
    expect(response.html).toBe(
      renderRegisterVirtualRowsHTML(model, range, 10, 'wp-filter', filter)
    );
    // Matched rows only (11 of 30), full-data indexes, filtered aria
    // positions, and highlight marks — all across the protocol.
    expect(response.html).not.toContain('data-row-index="0"');
    expect(response.html).toContain('data-row-index="10"');
    expect(response.html).toContain('aria-rowindex="1"');
    expect(response.html).toContain('<mark data-filter-match>Payee 1</mark>');
    expect(response.html).toContain("data-row-selected='true'");
  });

  test('grouped + filtered register-window stays byte-identical and recomputes group summaries', () => {
    const rows = makeRows(60).map((row, index) => ({
      ...row,
      entry: {
        ...row.entry,
        date: `2026-${String(Math.floor(index / 20) + 1).padStart(2, '0')}-10`,
        // Matches land in months 1 and 3 only; month 2's header must drop.
        payee: index % 20 < 2 && index < 20 ? 'needle a' : row.entry.payee,
        narration: index >= 40 && index < 42 ? 'needle b' : row.entry.narration,
      },
    }));
    const filter: RegisterFilter = { query: 'needle' };
    const model = buildFilteredRegisterRowModel(
      rows,
      'month',
      computeRegisterFilterMatches(rows, filter)
    );
    const range = { start: 0, end: model.length };
    const response = handleWorkerRequest({
      type: 'register-window',
      id: 't2gf',
      rows,
      range,
      selectedIndex: null,
      groupBy: 'month',
      filter,
    });
    if (
      response.type !== 'success' ||
      response.requestType !== 'register-window'
    ) {
      throw new Error('expected register-window success');
    }
    expect(response.html).toBe(
      renderRegisterVirtualRowsHTML(model, range, null, undefined, filter)
    );
    expect(response.html).toContain('data-group-key="2026-01"');
    expect(response.html).not.toContain('data-group-key="2026-02"');
    expect(response.html).toContain('data-group-key="2026-03"');
    // Recomputed over matches: 2 entries per surviving month.
    expect(response.html).toContain('2 entries');
  });

  test('empty-query filters take the unfiltered path byte for byte', () => {
    const rows = makeRows(20);
    const range = { start: 0, end: 20 };
    const response = handleWorkerRequest({
      type: 'register-window',
      id: 't2e',
      rows,
      range,
      selectedIndex: null,
      filter: { query: '' },
    });
    if (
      response.type !== 'success' ||
      response.requestType !== 'register-window'
    ) {
      throw new Error('expected register-window success');
    }
    expect(response.html).toBe(renderRegisterRowsHTML(rows, range, null));
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
