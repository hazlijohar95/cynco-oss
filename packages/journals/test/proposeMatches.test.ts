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
        postings: matches[0].postings,
        kind: 'exact',
        status: 'proposed',
        dateDelta: 0,
      },
    ]);
    expect(matches[0].postings[0].entry.id).toBe('e1');
    expect(matches[0].postings[0].postingIndex).toBe(0);
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
    expect(nearest[0].postings[0].entry.id).toBe('near');
    expect(nearest[0].dateDelta).toBe(1);

    const equidistant = proposeMatches(lines, [
      makeBookPosting({ entryId: 'after', date: '2026-07-12', amount: 5_000 }),
      makeBookPosting({ entryId: 'before', date: '2026-07-08', amount: 5_000 }),
    ]);
    expect(equidistant[0].postings[0].entry.id).toBe('before');
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
    const entryIds = matches.map((match) => match.postings[0].entry.id);
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

describe('proposeMatches sum pass', () => {
  test('a 2-posting sum covers one statement line', () => {
    const matches = proposeMatches(
      [makeStatementLine({ id: 's1', date: '2026-07-10', amount: 15_000 })],
      [
        makeBookPosting({ entryId: 'e1', date: '2026-07-10', amount: 9_000 }),
        makeBookPosting({ entryId: 'e2', date: '2026-07-10', amount: 6_000 }),
      ]
    );
    expect(matches.length).toBe(1);
    expect(matches[0].kind).toBe('sum');
    expect(matches[0].id).toBe('m-s1-e1-0+e2-0');
    expect(matches[0].postings.map((ref) => ref.entry.id)).toEqual([
      'e1',
      'e2',
    ]);
  });

  test('a 3-posting sum is found and dateDelta reports the worst shift', () => {
    const matches = proposeMatches(
      [makeStatementLine({ id: 's1', date: '2026-07-10', amount: 10_000 })],
      [
        makeBookPosting({ entryId: 'e1', date: '2026-07-10', amount: 5_000 }),
        makeBookPosting({ entryId: 'e2', date: '2026-07-11', amount: 3_000 }),
        makeBookPosting({ entryId: 'e3', date: '2026-07-08', amount: 2_000 }),
      ]
    );
    expect(matches.length).toBe(1);
    expect(matches[0].kind).toBe('sum');
    expect(new Set(matches[0].postings.map((ref) => ref.entry.id))).toEqual(
      new Set(['e1', 'e2', 'e3'])
    );
    expect(matches[0].dateDelta).toBe(-2);
  });

  test('mixed-sign groups sum correctly (refund against a charge)', () => {
    const matches = proposeMatches(
      [makeStatementLine({ id: 's1', date: '2026-07-10', amount: 7_000 })],
      [
        makeBookPosting({ entryId: 'e1', date: '2026-07-10', amount: 9_000 }),
        makeBookPosting({ entryId: 'e2', date: '2026-07-10', amount: -2_000 }),
      ]
    );
    expect(matches.length).toBe(1);
    expect(matches[0].kind).toBe('sum');
    expect(matches[0].postings.length).toBe(2);
  });

  test('maxGroupSize bounds the group and 1 disables sum matching', () => {
    const lines = [
      makeStatementLine({ id: 's1', date: '2026-07-10', amount: 10_000 }),
    ];
    const postings = [
      makeBookPosting({ entryId: 'e1', date: '2026-07-10', amount: 4_000 }),
      makeBookPosting({ entryId: 'e2', date: '2026-07-10', amount: 3_000 }),
      makeBookPosting({ entryId: 'e3', date: '2026-07-10', amount: 2_000 }),
      makeBookPosting({ entryId: 'e4', date: '2026-07-10', amount: 1_000 }),
    ];
    // Needs all four postings; the default cap of 3 must not find it.
    expect(proposeMatches(lines, postings)).toEqual([]);
    expect(proposeMatches(lines, postings, { maxGroupSize: 4 }).length).toBe(1);
    // maxGroupSize 1 disables pass 3 entirely: no false positives.
    const twoPart = [
      makeBookPosting({ entryId: 'e1', date: '2026-07-10', amount: 6_000 }),
      makeBookPosting({ entryId: 'e2', date: '2026-07-10', amount: 4_000 }),
    ];
    expect(proposeMatches(lines, twoPart, { maxGroupSize: 1 })).toEqual([]);
  });

  test('sum groups respect the date window', () => {
    const lines = [
      makeStatementLine({ id: 's1', date: '2026-07-10', amount: 10_000 }),
    ];
    const postings = [
      makeBookPosting({ entryId: 'e1', date: '2026-07-10', amount: 6_000 }),
      makeBookPosting({ entryId: 'e2', date: '2026-07-20', amount: 4_000 }),
    ];
    expect(proposeMatches(lines, postings)).toEqual([]);
    expect(proposeMatches(lines, postings, { dateWindowDays: 10 }).length).toBe(
      1
    );
  });

  test('sum pass only consumes postings the earlier passes left over', () => {
    // e1 pairs exactly with s1; the sum for s2 must use e2 + e3 only.
    const matches = proposeMatches(
      [
        makeStatementLine({ id: 's1', date: '2026-07-10', amount: 5_000 }),
        makeStatementLine({ id: 's2', date: '2026-07-10', amount: 8_000 }),
      ],
      [
        makeBookPosting({ entryId: 'e1', date: '2026-07-10', amount: 5_000 }),
        makeBookPosting({ entryId: 'e2', date: '2026-07-10', amount: 5_000 }),
        makeBookPosting({ entryId: 'e3', date: '2026-07-10', amount: 3_000 }),
      ]
    );
    expect(matches.length).toBe(2);
    expect(matches[0]).toMatchObject({ statementLineId: 's1', kind: 'exact' });
    expect(matches[1].kind).toBe('sum');
    expect(new Set(matches[1].postings.map((ref) => ref.entry.id))).toEqual(
      new Set(['e2', 'e3'])
    );
  });

  test('deterministic sum groups regardless of posting array order', () => {
    const lines = [
      makeStatementLine({ id: 's1', date: '2026-07-10', amount: 9_000 }),
    ];
    const postings = [
      makeBookPosting({ entryId: 'e1', date: '2026-07-10', amount: 5_000 }),
      makeBookPosting({ entryId: 'e2', date: '2026-07-10', amount: 4_000 }),
      makeBookPosting({ entryId: 'e3', date: '2026-07-11', amount: 5_000 }),
      makeBookPosting({ entryId: 'e4', date: '2026-07-11', amount: 4_000 }),
    ];
    const forward = proposeMatches(lines, postings);
    const reversed = proposeMatches(lines, [...postings].reverse());
    expect(forward).toEqual(reversed);
    // Nearest-dated candidates first, then larger amounts: e1 + e2.
    expect(forward[0].id).toBe('m-s1-e1-0+e2-0');
  });

  test('the combination cap aborts pathological searches without matching', () => {
    // 40 same-currency postings of amount 1 within the window and a target
    // that needs an impossible combination: with a tiny cap the search must
    // give up quickly and produce no match (never a wrong one).
    const lines = [
      makeStatementLine({ id: 's1', date: '2026-07-10', amount: 999_999 }),
    ];
    const postings = Array.from({ length: 40 }, (_, index) =>
      makeBookPosting({
        entryId: `e${String(index).padStart(2, '0')}`,
        date: '2026-07-10',
        amount: 1,
      })
    );
    expect(proposeMatches(lines, postings, { maxSumCombinations: 50 })).toEqual(
      []
    );
    expect(proposeMatches(lines, postings)).toEqual([]);
  });
});
