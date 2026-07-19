import { describe, expect, test } from 'bun:test';

import { MAX_FIELD_DIFF_LENGTH } from '../src/constants';
import type { Posting } from '../src/types';
import { diffEntryVersions } from '../src/utils/diffEntryVersions';
import { diffWords } from '../src/utils/diffWords';
import { makeEntry } from './domHarness';

// Pure compute layer: no DOM needed. Fixtures come from the shared
// makeEntry so field values stay consistent with the renderer suites.

describe('diffWords', () => {
  test('marks changed words and keeps surrounding text unchanged', () => {
    const result = diffWords(
      'Monthly consulting invoice',
      'Monthly retainer invoice'
    );
    expect(result).not.toBeNull();
    expect(result?.before).toEqual([
      { changed: false, text: 'Monthly ' },
      { changed: true, text: 'consulting' },
      { changed: false, text: ' invoice' },
    ]);
    expect(result?.after).toEqual([
      { changed: false, text: 'Monthly ' },
      { changed: true, text: 'retainer' },
      { changed: false, text: ' invoice' },
    ]);
  });

  test('joins adjacent changed regions separated by a single space', () => {
    // 'rent now' -> 'x y': two changed words with one unchanged space
    // between them merge into a single phrase-level region on each side.
    const result = diffWords('pay rent now ok', 'pay x y ok');
    expect(result?.before).toEqual([
      { changed: false, text: 'pay ' },
      { changed: true, text: 'rent now' },
      { changed: false, text: ' ok' },
    ]);
    expect(result?.after).toEqual([
      { changed: false, text: 'pay ' },
      { changed: true, text: 'x y' },
      { changed: false, text: ' ok' },
    ]);
  });

  test('reassembled segments reproduce the input byte for byte', () => {
    const before = 'one  two\tthree four';
    const after = 'one two three five';
    const result = diffWords(before, after);
    const join = (segments: readonly { text: string }[]): string =>
      segments.map((segment) => segment.text).join('');
    expect(join(result?.before ?? [])).toBe(before);
    expect(join(result?.after ?? [])).toBe(after);
  });

  test('returns null past the length cap so callers mark the whole field changed', () => {
    const long = 'a'.repeat(MAX_FIELD_DIFF_LENGTH + 1);
    expect(diffWords(long, 'short')).toBeNull();
    expect(diffWords('short', long)).toBeNull();
    // Exactly at the cap still diffs.
    const atCap = 'b'.repeat(MAX_FIELD_DIFF_LENGTH);
    expect(diffWords(atCap, atCap)).not.toBeNull();
  });

  test('whitespace-only edits return null instead of a highlight-free diff', () => {
    // Words are identical, so word-level LCS sees no change — rendering
    // "changed, nothing highlighted" would lie; the null fallback marks the
    // whole field changed instead.
    expect(diffWords('a b', 'a  b')).toBeNull();
    expect(diffWords('one two', 'one\ttwo')).toBeNull();
    expect(diffWords('trailing', 'trailing ')).toBeNull();
    // Identical strings still produce a (fully unchanged) diff.
    expect(diffWords('same text', 'same text')).not.toBeNull();
  });
});

describe('diffEntryVersions header fields', () => {
  test('identical versions classify every field unchanged', () => {
    const diff = diffEntryVersions(makeEntry(), makeEntry());
    expect(diff.kind).toBe('unchanged');
    expect(diff.date.kind).toBe('unchanged');
    expect(diff.flag.kind).toBe('unchanged');
    expect(diff.payee.kind).toBe('unchanged');
    expect(diff.narration.kind).toBe('unchanged');
    expect(diff.tags.kind).toBe('unchanged');
    expect(diff.links.kind).toBe('unchanged');
  });

  test('scalar fields classify changed/added/removed', () => {
    const diff = diffEntryVersions(
      makeEntry({ date: '2026-07-18', payee: null, flag: 'pending' }),
      makeEntry({ date: '2026-07-19', payee: 'Acme Sdn Bhd', flag: 'cleared' })
    );
    expect(diff.kind).toBe('modified');
    expect(diff.date).toMatchObject({
      kind: 'changed',
      before: '2026-07-18',
      after: '2026-07-19',
    });
    // date/flag are not prose fields: no word-level segments.
    expect(diff.date.beforeSegments).toBeNull();
    expect(diff.flag.kind).toBe('changed');
    expect(diff.payee).toMatchObject({ kind: 'added', after: 'Acme Sdn Bhd' });

    const removed = diffEntryVersions(
      makeEntry({ payee: 'Acme Sdn Bhd' }),
      makeEntry({ payee: null })
    );
    expect(removed.payee).toMatchObject({
      kind: 'removed',
      before: 'Acme Sdn Bhd',
    });
  });

  test('empty strings classify as absent, matching the renderer omitting them', () => {
    const diff = diffEntryVersions(
      makeEntry({ narration: '' }),
      makeEntry({ narration: 'New text' })
    );
    expect(diff.narration.kind).toBe('added');
  });

  test('changed narration carries word-level regions', () => {
    const diff = diffEntryVersions(
      makeEntry({ narration: 'Monthly consulting invoice' }),
      makeEntry({ narration: 'Monthly retainer invoice' })
    );
    expect(diff.narration.kind).toBe('changed');
    expect(diff.narration.beforeSegments).toEqual([
      { changed: false, text: 'Monthly ' },
      { changed: true, text: 'consulting' },
      { changed: false, text: ' invoice' },
    ]);
    expect(diff.narration.afterSegments).toEqual([
      { changed: false, text: 'Monthly ' },
      { changed: true, text: 'retainer' },
      { changed: false, text: ' invoice' },
    ]);
  });

  test('fields past the diff cap classify changed with null segments', () => {
    const diff = diffEntryVersions(
      makeEntry({ narration: 'x '.repeat(600).trim() }),
      makeEntry({ narration: 'y' })
    );
    expect(diff.narration.kind).toBe('changed');
    expect(diff.narration.beforeSegments).toBeNull();
    expect(diff.narration.afterSegments).toBeNull();
  });

  test('tag/link diffs are membership-based with removed items appended', () => {
    const diff = diffEntryVersions(
      makeEntry({ tags: ['ops', 'old'], links: ['inv-42'] }),
      makeEntry({ tags: ['ops', 'new'], links: ['inv-42'] })
    );
    expect(diff.tags.kind).toBe('changed');
    expect(diff.tags.items).toEqual([
      { value: 'ops', kind: 'unchanged' },
      { value: 'new', kind: 'added' },
      { value: 'old', kind: 'removed' },
    ]);
    expect(diff.links.kind).toBe('unchanged');
  });
});

describe('diffEntryVersions posting alignment', () => {
  const cash = 'Assets:Current:Cash-Maybank';
  const sales = 'Income:Sales:Consulting';
  const fees = 'Expenses:Bank:Fees';

  function makeVersion(postings: Posting[]): ReturnType<typeof makeEntry> {
    return makeEntry({ postings });
  }

  test('exact, amount-changed, added, and removed postings', () => {
    const diff = diffEntryVersions(
      makeVersion([
        { account: cash, amount: 150_000, currency: 'MYR' },
        { account: sales, amount: -150_000, currency: 'MYR' },
      ]),
      makeVersion([
        { account: cash, amount: 149_000, currency: 'MYR' },
        { account: sales, amount: -150_000, currency: 'MYR' },
        { account: fees, amount: 1_000, currency: 'MYR' },
      ])
    );
    expect(diff.postings).toEqual([
      {
        kind: 'amount-changed',
        account: cash,
        currency: 'MYR',
        beforeAmount: 150_000,
        afterAmount: 149_000,
      },
      {
        kind: 'unchanged',
        account: sales,
        currency: 'MYR',
        beforeAmount: -150_000,
        afterAmount: -150_000,
      },
      {
        kind: 'added',
        account: fees,
        currency: 'MYR',
        beforeAmount: null,
        afterAmount: 1_000,
      },
    ]);
  });

  test('removed postings append after the after-side order', () => {
    const diff = diffEntryVersions(
      makeVersion([
        { account: cash, amount: 100, currency: 'MYR' },
        { account: fees, amount: 50, currency: 'MYR' },
        { account: sales, amount: -150, currency: 'MYR' },
      ]),
      makeVersion([
        { account: cash, amount: 100, currency: 'MYR' },
        { account: sales, amount: -100, currency: 'MYR' },
      ])
    );
    expect(diff.postings.map((posting) => posting.kind)).toEqual([
      'unchanged',
      'amount-changed',
      'removed',
    ]);
    expect(diff.postings[2].account).toBe(fees);
  });

  test('multi-currency: same account in different currencies never pairs', () => {
    const diff = diffEntryVersions(
      makeVersion([{ account: cash, amount: 100, currency: 'MYR' }]),
      makeVersion([{ account: cash, amount: 100, currency: 'USD' }])
    );
    expect(diff.postings).toEqual([
      {
        kind: 'added',
        account: cash,
        currency: 'USD',
        beforeAmount: null,
        afterAmount: 100,
      },
      {
        kind: 'removed',
        account: cash,
        currency: 'MYR',
        beforeAmount: 100,
        afterAmount: null,
      },
    ]);
  });

  test('duplicate (account, currency) pairs: exact matches win, leftovers pair in input order', () => {
    const diff = diffEntryVersions(
      makeVersion([
        { account: cash, amount: 100, currency: 'MYR' },
        { account: cash, amount: 200, currency: 'MYR' },
      ]),
      makeVersion([
        { account: cash, amount: 200, currency: 'MYR' },
        { account: cash, amount: 300, currency: 'MYR' },
      ])
    );
    // after[0] (200) exact-matches before[1]; after[1] (300) pairs with the
    // remaining before[0] (100) as amount-changed.
    expect(diff.postings).toEqual([
      {
        kind: 'unchanged',
        account: cash,
        currency: 'MYR',
        beforeAmount: 200,
        afterAmount: 200,
      },
      {
        kind: 'amount-changed',
        account: cash,
        currency: 'MYR',
        beforeAmount: 100,
        afterAmount: 300,
      },
    ]);
  });
});

describe('diffEntryVersions null versions', () => {
  test('before null: creation — everything added', () => {
    const diff = diffEntryVersions(null, makeEntry());
    expect(diff.kind).toBe('created');
    expect(diff.date.kind).toBe('added');
    expect(diff.payee.kind).toBe('added');
    expect(diff.narration.kind).toBe('added');
    expect(diff.tags.kind).toBe('added');
    expect(diff.postings.map((posting) => posting.kind)).toEqual([
      'added',
      'added',
    ]);
    expect(diff.postings.every((posting) => posting.beforeAmount == null)).toBe(
      true
    );
  });

  test('after null: deletion — everything removed', () => {
    const diff = diffEntryVersions(makeEntry(), null);
    expect(diff.kind).toBe('deleted');
    expect(diff.date.kind).toBe('removed');
    expect(diff.payee.kind).toBe('removed');
    expect(diff.tags.kind).toBe('removed');
    expect(diff.postings.map((posting) => posting.kind)).toEqual([
      'removed',
      'removed',
    ]);
    expect(diff.postings.every((posting) => posting.afterAmount == null)).toBe(
      true
    );
  });

  test('both null degrades to an empty unchanged diff instead of throwing', () => {
    const diff = diffEntryVersions(null, null);
    expect(diff.kind).toBe('unchanged');
    expect(diff.postings).toEqual([]);
  });
});
