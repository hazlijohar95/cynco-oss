import { describe, expect, test } from 'bun:test';

import { proposeMatches } from '../src/utils/proposeMatches';
import { makeBookPosting, makeStatementLine } from './domHarness';

describe('proposeMatches', () => {
  test('empty inputs produce no matches', () => {
    expect(proposeMatches([], [])).toEqual([]);
    expect(
      proposeMatches(
        [makeStatementLine({ id: 's1', date: '2026-07-01', amount: 100 })],
        []
      )
    ).toEqual([]);
    expect(
      proposeMatches(
        [],
        [makeBookPosting({ entryId: 'e1', date: '2026-07-01', amount: 100 })]
      )
    ).toEqual([]);
  });

  test('pass 1: exact amount + currency + date matches with delta 0', () => {
    const matches = proposeMatches(
      [makeStatementLine({ id: 's1', date: '2026-07-10', amount: 15_000 })],
      [makeBookPosting({ entryId: 'e1', date: '2026-07-10', amount: 15_000 })]
    );
    expect(matches).toEqual([
      {
        id: 'm-s1-e1-0',
        statementLineId: 's1',
        posting: matches[0].posting,
        kind: 'exact',
        status: 'proposed',
        dateDelta: 0,
      },
    ]);
    expect(matches[0].posting.entry.id).toBe('e1');
    expect(matches[0].posting.postingIndex).toBe(0);
  });

  test('pass 2: window match reports the signed book − statement delta', () => {
    const matches = proposeMatches(
      [makeStatementLine({ id: 's1', date: '2026-07-10', amount: 15_000 })],
      [makeBookPosting({ entryId: 'e1', date: '2026-07-08', amount: 15_000 })]
    );
    expect(matches.length).toBe(1);
    expect(matches[0].kind).toBe('suggested');
    expect(matches[0].dateDelta).toBe(-2);
  });

  test('window is bounded by dateWindowDays', () => {
    const lines = [
      makeStatementLine({ id: 's1', date: '2026-07-10', amount: 15_000 }),
    ];
    const postings = [
      makeBookPosting({ entryId: 'e1', date: '2026-07-14', amount: 15_000 }),
    ];
    expect(proposeMatches(lines, postings)).toEqual([]);
    expect(proposeMatches(lines, postings, { dateWindowDays: 4 }).length).toBe(
      1
    );
    expect(proposeMatches(lines, postings, { dateWindowDays: 0 })).toEqual([]);
  });

  test('nearest date wins; equidistant candidates prefer the earlier book date', () => {
    const lines = [
      makeStatementLine({ id: 's1', date: '2026-07-10', amount: 5_000 }),
    ];
    const nearest = proposeMatches(lines, [
      makeBookPosting({ entryId: 'far', date: '2026-07-13', amount: 5_000 }),
      makeBookPosting({ entryId: 'near', date: '2026-07-11', amount: 5_000 }),
    ]);
    expect(nearest[0].posting.entry.id).toBe('near');
    expect(nearest[0].dateDelta).toBe(1);

    const equidistant = proposeMatches(lines, [
      makeBookPosting({ entryId: 'after', date: '2026-07-12', amount: 5_000 }),
      makeBookPosting({ entryId: 'before', date: '2026-07-08', amount: 5_000 }),
    ]);
    expect(equidistant[0].posting.entry.id).toBe('before');
    expect(equidistant[0].dateDelta).toBe(-2);
  });

  test('contested posting goes to the earlier statement line id', () => {
    // Both lines are 1 day from the single posting; s1 must win.
    const matches = proposeMatches(
      [
        makeStatementLine({ id: 's2', date: '2026-07-12', amount: 5_000 }),
        makeStatementLine({ id: 's1', date: '2026-07-10', amount: 5_000 }),
      ],
      [makeBookPosting({ entryId: 'e1', date: '2026-07-11', amount: 5_000 })]
    );
    expect(matches.length).toBe(1);
    expect(matches[0].statementLineId).toBe('s1');
  });

  test('1:1 exclusivity: each line and posting is used at most once', () => {
    const matches = proposeMatches(
      [
        makeStatementLine({ id: 's1', date: '2026-07-10', amount: 5_000 }),
        makeStatementLine({ id: 's2', date: '2026-07-10', amount: 5_000 }),
        makeStatementLine({ id: 's3', date: '2026-07-10', amount: 5_000 }),
      ],
      [
        makeBookPosting({ entryId: 'e1', date: '2026-07-10', amount: 5_000 }),
        makeBookPosting({ entryId: 'e2', date: '2026-07-11', amount: 5_000 }),
      ]
    );
    expect(matches.length).toBe(2);
    const lineIds = matches.map((match) => match.statementLineId);
    const entryIds = matches.map((match) => match.posting.entry.id);
    expect(new Set(lineIds).size).toBe(2);
    expect(new Set(entryIds).size).toBe(2);
    // Exact pass gives s1 the same-date posting; s2 gets the +1d suggestion.
    expect(matches.find((m) => m.statementLineId === 's1')?.kind).toBe('exact');
    expect(matches.find((m) => m.statementLineId === 's2')?.kind).toBe(
      'suggested'
    );
  });

  test('currencies never cross-match even with equal amounts and dates', () => {
    const matches = proposeMatches(
      [
        makeStatementLine({
          id: 's1',
          date: '2026-07-10',
          amount: 5_000,
          currency: 'USD',
        }),
        makeStatementLine({
          id: 's2',
          date: '2026-07-10',
          amount: 5_000,
          currency: 'MYR',
        }),
      ],
      [
        makeBookPosting({
          entryId: 'e1',
          date: '2026-07-10',
          amount: 5_000,
          currency: 'MYR',
        }),
      ]
    );
    expect(matches.length).toBe(1);
    expect(matches[0].statementLineId).toBe('s2');
  });

  test('deterministic: input array order never changes the result', () => {
    const lines = [
      makeStatementLine({ id: 's1', date: '2026-07-10', amount: 5_000 }),
      makeStatementLine({ id: 's2', date: '2026-07-11', amount: 5_000 }),
      makeStatementLine({ id: 's3', date: '2026-07-15', amount: 700 }),
    ];
    const postings = [
      makeBookPosting({ entryId: 'e1', date: '2026-07-11', amount: 5_000 }),
      makeBookPosting({ entryId: 'e2', date: '2026-07-09', amount: 5_000 }),
      makeBookPosting({ entryId: 'e3', date: '2026-07-15', amount: 700 }),
    ];
    const forward = proposeMatches(lines, postings);
    const reversed = proposeMatches(
      [...lines].reverse(),
      [...postings].reverse()
    );
    expect(reversed).toEqual(forward);
    expect(forward.map((match) => match.id)).toEqual([
      'm-s1-e2-0',
      'm-s2-e1-0',
      'm-s3-e3-0',
    ]);
  });
});
