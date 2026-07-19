// Register engine: holds ledger entries in (date, id) order and answers
// slice-first register queries (one account's postings with running
// balances) plus entry-level filtering. Mutations replace whole entries by
// id and fire honest invalidation events.
//
// Running balances are served from a per-account prefix-sum index (one
// Float64Array per currency; exact for integer minor units up to 2^53),
// built once per (account, includeDescendants) query and cached until the
// next mutation. Virtualized register UIs re-read slices on every scroll
// frame, so slice reads must never re-scan the whole entry list.

import { isValidAccountPath } from './accountPath';
import { chunksOf } from './chunksOf';
import type {
  EntryFilter,
  EntryIngestOptions,
  EntryIngestResult,
  LedgerEntry,
  MutationEvent,
  RegisterOptions,
  RegisterRow,
} from './types';

// Default entries per addEntriesAsync chunk: large enough that per-chunk
// sort/event overhead stays negligible, small enough that one chunk applies
// well inside a frame budget on the 1M-entry workload.
const DEFAULT_INGEST_CHUNK_SIZE = 5000;

// One cached register: which (entry, posting) pairs touch the account, in
// entry order, plus per-currency prefix sums aligned to those rows.
// prefixSumsByCurrency.get(c)[i] is the running balance in currency c after
// row i (carry-forward semantics: rows in other currencies keep the previous
// value), so any row's own-currency running balance is a single array read.
interface RegisterIndex {
  entryIndices: Int32Array;
  postingIndices: Int32Array;
  prefixSumsByCurrency: Map<string, Float64Array>;
}

// Entries sort by (date, id); ISO dates compare correctly as strings. Ids
// are unique per store, so this is a total order and insertion is stable by
// construction (no two entries ever tie).
function compareEntries(a: LedgerEntry, b: LedgerEntry): number {
  if (a.date < b.date) {
    return -1;
  }
  if (a.date > b.date) {
    return 1;
  }
  if (a.id < b.id) {
    return -1;
  }
  return a.id > b.id ? 1 : 0;
}

// True when a posting on `account` belongs to the register of `path`.
// `descendantPrefix` is the precomputed `path + ':'` so the hot loop does a
// single startsWith instead of re-concatenating per posting.
function accountMatchesRegister(
  account: string,
  path: string,
  descendantPrefix: string | null
): boolean {
  if (account === path) {
    return true;
  }
  return descendantPrefix != null && account.startsWith(descendantPrefix);
}

export class EntryStore {
  /** Entries in (date, id) order. Replaced wholesale on mutation. */
  private entries: LedgerEntry[];
  /** Fast id lookups and duplicate detection across mutations. */
  private readonly entryById: Map<string, LedgerEntry>;
  /**
   * Lowercase `payee + '\n' + narration` per sorted entry index, built
   * lazily on the first search so repeated queries never re-lowercase the
   * corpus. Null after any mutation (rebuilt on next search).
   */
  private searchTextByIndex: string[] | null;
  /** Register indexes keyed by `S:` / `D:` + account path; see buildRegisterIndex. */
  private readonly registerCache: Map<string, RegisterIndex>;
  private readonly listeners: Set<(event: MutationEvent) => void>;

  constructor(entries: readonly LedgerEntry[] = []) {
    this.entries = [];
    this.entryById = new Map<string, LedgerEntry>();
    this.searchTextByIndex = null;
    this.registerCache = new Map<string, RegisterIndex>();
    this.listeners = new Set<(event: MutationEvent) => void>();
    // Constructor ingest reuses the addEntries dedupe rules but fires no
    // mutation event: nothing observed the store before it existed.
    for (const entry of entries) {
      if (!this.entryById.has(entry.id)) {
        this.entryById.set(entry.id, entry);
        this.entries.push(entry);
      }
    }
    this.entries.sort(compareEntries);
  }

  // --- Reads --------------------------------------------------------------------

  /** Total number of entries in the store. */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Entries for the half-open range `[start, end)` in (date, id) order,
   * clamped to the valid range.
   */
  getEntrySlice(start: number, end: number): LedgerEntry[] {
    const clampedStart = Math.max(0, Math.floor(start));
    const clampedEnd = Math.min(this.entries.length, Math.floor(end));
    return this.entries.slice(clampedStart, Math.max(clampedStart, clampedEnd));
  }

  /** The entry with the given id, or null when unknown. */
  getEntryById(id: string): LedgerEntry | null {
    return this.entryById.get(id) ?? null;
  }

  /**
   * All entries matching the filter, in (date, id) order. A full scan —
   * intended for command palettes and reports, not per-frame reads.
   */
  filterEntries(filter: EntryFilter): LedgerEntry[] {
    const matches: LedgerEntry[] = [];
    for (let index = 0; index < this.entries.length; index += 1) {
      if (this.entryMatchesFilter(index, filter)) {
        matches.push(this.entries[index]);
      }
    }
    return matches;
  }

  // --- Register queries -----------------------------------------------------------

  /**
   * Number of register rows (postings) for one account. Unfiltered counts
   * come from the cached index; filtered counts scan (see getRegisterRows).
   */
  getRegisterRowCount(
    accountPath: string,
    options: Pick<RegisterOptions, 'filter' | 'includeDescendants'> = {}
  ): number {
    if (!isValidAccountPath(accountPath)) {
      return 0;
    }
    const includeDescendants = options.includeDescendants === true;
    if (options.filter == null) {
      return this.getRegisterIndex(accountPath, includeDescendants).entryIndices
        .length;
    }
    const descendantPrefix = includeDescendants ? `${accountPath}:` : null;
    let count = 0;
    for (let index = 0; index < this.entries.length; index += 1) {
      if (!this.entryMatchesFilter(index, options.filter)) {
        continue;
      }
      for (const posting of this.entries[index].postings) {
        if (
          accountMatchesRegister(posting.account, accountPath, descendantPrefix)
        ) {
          count += 1;
        }
      }
    }
    return count;
  }

  /**
   * Virtualization-ready register rows for the half-open range
   * `[start, end)` of one account's register. Each row pairs the entry with
   * the matching posting and the running balance in that posting's currency.
   *
   * Unfiltered queries read the cached prefix-sum index (O(slice) per call).
   * Filtered queries recompute running balances over the filtered posting
   * sequence in one scan (O(entries)) and bypass the cache — a filtered
   * running balance is a different number sequence, so caching it per filter
   * would trade unbounded memory for little reuse.
   */
  getRegisterRows(
    accountPath: string,
    options: RegisterOptions
  ): RegisterRow[] {
    if (!isValidAccountPath(accountPath)) {
      return [];
    }
    const includeDescendants = options.includeDescendants === true;
    if (options.filter == null) {
      return this.readCachedRegisterSlice(
        accountPath,
        includeDescendants,
        options.start,
        options.end
      );
    }
    return this.scanFilteredRegisterSlice(
      accountPath,
      includeDescendants,
      options.start,
      options.end,
      options.filter
    );
  }

  // --- Mutations --------------------------------------------------------------------

  /**
   * Subscribes to mutation events. Returns an unsubscribe function. Events
   * fire synchronously after the store state is consistent, once per
   * mutation call.
   */
  onMutation(listener: (event: MutationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Inserts new entries in sorted position. Entries whose id already exists
   * in the store (or earlier in the batch) are skipped — adds never
   * silently overwrite; use replaceEntries for that. The mutation event
   * lists only the entries actually inserted.
   */
  addEntries(entries: readonly LedgerEntry[]): void {
    const added: LedgerEntry[] = [];
    for (const entry of entries) {
      if (this.entryById.has(entry.id)) {
        continue;
      }
      this.entryById.set(entry.id, entry);
      added.push(entry);
    }
    if (added.length === 0) {
      return;
    }
    this.entries.push(...added);
    this.entries.sort(compareEntries);
    this.emitMutation(
      added.map((entry) => entry.id),
      [added]
    );
  }

  /**
   * Time-sliced bulk ingest: applies the source in whole chunks through the
   * synchronous addEntries path — so dedupe rules, cache invalidation, and
   * mutation events stay exactly as honest as a manual sequence of
   * addEntries calls — and yields to the event loop between chunks. The end
   * state is identical to one synchronous addEntries of the same data.
   *
   * When a cooperative scheduler is given, each chunk application runs as
   * one scheduler task (serialized FIFO with the caller's other scheduled
   * work); otherwise the ingest yields via setTimeout(0) directly. Aborting
   * via `options.signal` stops before the next chunk: chunks are atomic, so
   * the store is always in a consistent every-chunk-fully-applied state,
   * and the result reports `aborted: true` instead of rejecting. A rejected
   * scheduler task (scheduler aborted) does reject, mirroring the
   * scheduler's own contract.
   */
  async addEntriesAsync(
    entries: Iterable<LedgerEntry> | AsyncIterable<LedgerEntry>,
    options: EntryIngestOptions = {}
  ): Promise<EntryIngestResult> {
    const chunkSize = options.chunkSize ?? DEFAULT_INGEST_CHUNK_SIZE;
    const scheduler = options.scheduler;
    let added = 0;
    let skipped = 0;
    for await (const chunk of chunksOf(entries, chunkSize)) {
      if (options.signal?.aborted === true) {
        return { added, skipped, aborted: true };
      }
      // Counting through the public entry count keeps the added/skipped
      // numbers honest against addEntries' own dedupe, instead of
      // re-implementing the duplicate rules here.
      const applyChunk = (): number => {
        const before = this.entries.length;
        this.addEntries(chunk);
        return this.entries.length - before;
      };
      let addedInChunk: number;
      if (scheduler != null) {
        addedInChunk = await scheduler.schedule(
          (): { done: boolean; value?: number } => ({
            done: true,
            value: applyChunk(),
          })
        );
      } else {
        addedInChunk = applyChunk();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      added += addedInChunk;
      skipped += chunk.length - addedInChunk;
    }
    return { added, skipped, aborted: false };
  }

  /**
   * Removes entries by id. Unknown ids are ignored; the mutation event
   * lists only the entries actually removed.
   */
  removeEntries(ids: readonly string[]): void {
    const removed: LedgerEntry[] = [];
    for (const id of ids) {
      const entry = this.entryById.get(id);
      if (entry == null) {
        continue;
      }
      this.entryById.delete(id);
      removed.push(entry);
    }
    if (removed.length === 0) {
      return;
    }
    const removedIds = new Set(removed.map((entry) => entry.id));
    this.entries = this.entries.filter((entry) => !removedIds.has(entry.id));
    this.emitMutation([...removedIds], [removed]);
  }

  /**
   * Upserts entries by id: existing entries are replaced wholesale (the
   * replacement may change date, postings, anything except identity), new
   * ids are inserted. The mutation event's accountsChanged covers both the
   * old and new postings of replaced entries, since both registers need
   * invalidation.
   */
  replaceEntries(entries: readonly LedgerEntry[]): void {
    const changedIds: string[] = [];
    const changedPostingSources: LedgerEntry[] = [];
    for (const entry of entries) {
      const previous = this.entryById.get(entry.id);
      if (previous != null) {
        changedPostingSources.push(previous);
        const index = this.entries.indexOf(previous);
        if (index >= 0) {
          this.entries[index] = entry;
        }
      } else {
        this.entries.push(entry);
      }
      this.entryById.set(entry.id, entry);
      changedIds.push(entry.id);
      changedPostingSources.push(entry);
    }
    if (changedIds.length === 0) {
      return;
    }
    this.entries.sort(compareEntries);
    this.emitMutation(changedIds, [changedPostingSources]);
  }

  // --- Internals ---------------------------------------------------------------------

  /** Invalidate derived state and notify listeners after any mutation. */
  private emitMutation(
    entryIds: readonly string[],
    postingSources: ReadonlyArray<readonly LedgerEntry[]>
  ): void {
    // All cached register indexes and the lowercase search corpus are
    // positional over the sorted entry list, so any mutation invalidates
    // them wholesale. Finer-grained invalidation (only touched accounts)
    // would need per-key account-prefix checks for little practical win —
    // indexes rebuild lazily on next read anyway.
    this.registerCache.clear();
    this.searchTextByIndex = null;

    const accounts = new Set<string>();
    for (const source of postingSources) {
      for (const entry of source) {
        for (const posting of entry.postings) {
          accounts.add(posting.account);
        }
      }
    }
    const event: MutationEvent = {
      entriesChanged: [...new Set(entryIds)],
      accountsChanged: [...accounts],
    };
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** Applies an EntryFilter to the entry at a sorted index. */
  private entryMatchesFilter(index: number, filter: EntryFilter): boolean {
    const entry = this.entries[index];
    if (filter.dateFrom != null && entry.date < filter.dateFrom) {
      return false;
    }
    if (filter.dateTo != null && entry.date > filter.dateTo) {
      return false;
    }
    if (filter.flag != null && entry.flag !== filter.flag) {
      return false;
    }
    if (filter.tag != null && !entry.tags.includes(filter.tag)) {
      return false;
    }
    if (filter.query != null && filter.query !== '') {
      const needle = filter.query.toLowerCase();
      if (!this.getSearchText(index).includes(needle)) {
        return false;
      }
    }
    return true;
  }

  /** Lowercase search corpus for one entry, built lazily per store version. */
  private getSearchText(index: number): string {
    this.searchTextByIndex ??= this.entries.map((entry) =>
      `${entry.payee ?? ''}\n${entry.narration}`.toLowerCase()
    );
    return this.searchTextByIndex[index];
  }

  /** Cached register index for (account, includeDescendants), built on demand. */
  private getRegisterIndex(
    accountPath: string,
    includeDescendants: boolean
  ): RegisterIndex {
    const key = `${includeDescendants ? 'D' : 'S'}:${accountPath}`;
    const cached = this.registerCache.get(key);
    if (cached != null) {
      return cached;
    }
    const index = this.buildRegisterIndex(accountPath, includeDescendants);
    this.registerCache.set(key, index);
    return index;
  }

  /**
   * One pass over all entries collecting the (entry, posting) pairs that
   * touch the account, then per-currency prefix sums over those rows.
   * Postings with unsafe (non-integer) amounts are skipped so the prefix
   * sums stay exact integers.
   */
  private buildRegisterIndex(
    accountPath: string,
    includeDescendants: boolean
  ): RegisterIndex {
    const descendantPrefix = includeDescendants ? `${accountPath}:` : null;
    const entryIndices: number[] = [];
    const postingIndices: number[] = [];
    for (
      let entryIndex = 0;
      entryIndex < this.entries.length;
      entryIndex += 1
    ) {
      const postings = this.entries[entryIndex].postings;
      for (
        let postingIndex = 0;
        postingIndex < postings.length;
        postingIndex += 1
      ) {
        const posting = postings[postingIndex];
        if (
          Number.isSafeInteger(posting.amount) &&
          accountMatchesRegister(posting.account, accountPath, descendantPrefix)
        ) {
          entryIndices.push(entryIndex);
          postingIndices.push(postingIndex);
        }
      }
    }

    // Prefix sums with carry-forward: every currency's array is dense over
    // all rows (rows in other currencies repeat the previous value), so
    // "balance as of row i" is one read for any currency. Cost is
    // rows x currencies writes — currencies per account are few in
    // practice, and the arrays are reused across every slice read until the
    // next mutation.
    const rowCount = entryIndices.length;
    const prefixSumsByCurrency = new Map<string, Float64Array>();
    const runningByCurrency = new Map<string, number>();
    for (let row = 0; row < rowCount; row += 1) {
      const posting =
        this.entries[entryIndices[row]].postings[postingIndices[row]];
      let sums = prefixSumsByCurrency.get(posting.currency);
      if (sums == null) {
        sums = new Float64Array(rowCount);
        // Backfill rows before this currency's first posting with zero —
        // Float64Array is zero-initialized, so nothing to do explicitly.
        prefixSumsByCurrency.set(posting.currency, sums);
        runningByCurrency.set(posting.currency, 0);
      }
      const nextRunning =
        (runningByCurrency.get(posting.currency) ?? 0) + posting.amount;
      runningByCurrency.set(posting.currency, nextRunning);
      for (const [currency, currencySums] of prefixSumsByCurrency) {
        currencySums[row] = runningByCurrency.get(currency) ?? 0;
      }
    }

    return {
      entryIndices: Int32Array.from(entryIndices),
      postingIndices: Int32Array.from(postingIndices),
      prefixSumsByCurrency,
    };
  }

  /** Slice read against the cached prefix-sum index (unfiltered registers). */
  private readCachedRegisterSlice(
    accountPath: string,
    includeDescendants: boolean,
    start: number,
    end: number
  ): RegisterRow[] {
    const index = this.getRegisterIndex(accountPath, includeDescendants);
    const rowCount = index.entryIndices.length;
    const clampedStart = Math.max(0, Math.floor(start));
    const clampedEnd = Math.min(rowCount, Math.floor(end));
    const rows: RegisterRow[] = [];
    for (let row = clampedStart; row < clampedEnd; row += 1) {
      const entry = this.entries[index.entryIndices[row]];
      const posting = entry.postings[index.postingIndices[row]];
      const sums = index.prefixSumsByCurrency.get(posting.currency);
      rows.push({
        entry,
        posting,
        runningBalance: sums == null ? 0 : sums[row],
      });
    }
    return rows;
  }

  /**
   * Filtered register slice: one scan over all entries, accumulating
   * running balances for the filtered posting sequence, materializing only
   * rows inside [start, end). Early-exits once the slice is full — rows
   * after the slice cannot affect balances inside it.
   */
  private scanFilteredRegisterSlice(
    accountPath: string,
    includeDescendants: boolean,
    start: number,
    end: number,
    filter: EntryFilter
  ): RegisterRow[] {
    const descendantPrefix = includeDescendants ? `${accountPath}:` : null;
    const clampedStart = Math.max(0, Math.floor(start));
    const clampedEnd = Math.max(clampedStart, Math.floor(end));
    const rows: RegisterRow[] = [];
    const runningByCurrency = new Map<string, number>();
    let rowCursor = 0;
    for (
      let entryIndex = 0;
      entryIndex < this.entries.length;
      entryIndex += 1
    ) {
      if (rowCursor >= clampedEnd) {
        break;
      }
      if (!this.entryMatchesFilter(entryIndex, filter)) {
        continue;
      }
      const entry = this.entries[entryIndex];
      for (const posting of entry.postings) {
        if (
          !Number.isSafeInteger(posting.amount) ||
          !accountMatchesRegister(
            posting.account,
            accountPath,
            descendantPrefix
          )
        ) {
          continue;
        }
        const nextRunning =
          (runningByCurrency.get(posting.currency) ?? 0) + posting.amount;
        runningByCurrency.set(posting.currency, nextRunning);
        if (rowCursor >= clampedStart && rowCursor < clampedEnd) {
          rows.push({ entry, posting, runningBalance: nextRunning });
        }
        rowCursor += 1;
      }
    }
    return rows;
  }
}
