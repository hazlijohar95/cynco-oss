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
  MinorUnits,
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
  // Currencies whose running balance crossed 2^53 while the prefix sums were
  // accumulated. Postings are individually safe integers, but a long register
  // can push the carry-forward total past the exactly-representable range,
  // where the Float64Array silently loses integer precision. Surfaced via
  // `hasRunningBalanceOverflow` (flag, never silently repair). Empty for every
  // non-pathological register.
  overflowCurrencies: Set<string>;
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

// Merges a batch of new entries into an already-sorted list in one linear
// pass, returning a fresh sorted array. The batch is sorted on its own first
// (O(k log k) over just the additions), then the two sorted runs are merged
// (O(n + k)) — so a bulk ingest that arrives in chunks pays O(k log k) per
// chunk instead of re-sorting the whole growing list (O(n log n)) every time.
// Stable at ties by construction: entry ids are unique per store, so no two
// entries ever compare equal.
function mergeSortedEntries(
  sorted: readonly LedgerEntry[],
  added: LedgerEntry[]
): LedgerEntry[] {
  added.sort(compareEntries);
  const merged: LedgerEntry[] = new Array(sorted.length + added.length);
  let sortedIndex = 0;
  let addedIndex = 0;
  let mergedIndex = 0;
  while (sortedIndex < sorted.length && addedIndex < added.length) {
    if (compareEntries(sorted[sortedIndex], added[addedIndex]) <= 0) {
      merged[mergedIndex] = sorted[sortedIndex];
      sortedIndex += 1;
    } else {
      merged[mergedIndex] = added[addedIndex];
      addedIndex += 1;
    }
    mergedIndex += 1;
  }
  while (sortedIndex < sorted.length) {
    merged[mergedIndex] = sorted[sortedIndex];
    sortedIndex += 1;
    mergedIndex += 1;
  }
  while (addedIndex < added.length) {
    merged[mergedIndex] = added[addedIndex];
    addedIndex += 1;
    mergedIndex += 1;
  }
  return merged;
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
   * True when the running-balance column for an account's register left the
   * exactly-representable integer range (2^53) while accumulating. Past that
   * point running balances are no longer exact, so a caller needing
   * authoritative figures should treat the affected currencies as flagged.
   * Pass a currency to scope the check; omit it for "any currency overflowed".
   *
   * A surfacing mechanism, not a repair — the store never silently rewrites or
   * rejects overflowed balances, matching the balance-integrity contract.
   * Reflects the unfiltered register index (the same one that backs
   * `getRegisterRows` without a filter).
   */
  hasRunningBalanceOverflow(
    accountPath: string,
    options: Pick<RegisterOptions, 'includeDescendants'> & {
      currency?: string;
    } = {}
  ): boolean {
    if (!isValidAccountPath(accountPath)) {
      return false;
    }
    const index = this.getRegisterIndex(
      accountPath,
      options.includeDescendants === true
    );
    if (options.currency == null) {
      return index.overflowCurrencies.size > 0;
    }
    return index.overflowCurrencies.has(options.currency);
  }

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

  // --- Point-in-time balances ------------------------------------------------------

  /**
   * Balance of one account per currency as of the end of `date` (inclusive):
   * the sum of every register posting dated on or before it. Warm calls are
   * one binary search plus one array read per currency against the same
   * cached prefix-sum index that backs `getRegisterRows` — never a re-scan.
   *
   * Currencies with a zero balance are omitted; absence means zero, matching
   * the `AccountRow` balance convention. Invalid paths and dates before the
   * first posting yield an empty map. Balances share the exactness contract
   * of the register index: exact integers unless a running total crossed
   * 2^53, which `hasRunningBalanceOverflow` surfaces.
   */
  getBalancesAsOf(
    accountPath: string,
    date: string,
    options: Pick<RegisterOptions, 'includeDescendants'> = {}
  ): Map<string, MinorUnits> {
    const balances = new Map<string, MinorUnits>();
    if (!isValidAccountPath(accountPath)) {
      return balances;
    }
    const index = this.getRegisterIndex(
      accountPath,
      options.includeDescendants === true
    );
    const row = this.findLastRowOnOrBefore(index, date);
    if (row < 0) {
      return balances;
    }
    for (const [currency, sums] of index.prefixSumsByCurrency) {
      const balance = sums[row];
      if (balance !== 0) {
        balances.set(currency, balance);
      }
    }
    return balances;
  }

  /**
   * Net movement of one account per currency across the inclusive date range
   * `[dateFrom, dateTo]`: the sum of register postings dated inside it. This
   * is the period-activity query financial statements are built on — a P&L
   * line is the balance change of an income or expense account over the
   * reporting period.
   *
   * Computed as two prefix-sum reads (balance through `dateTo` minus balance
   * through the day before `dateFrom`, located by binary search), so no date
   * arithmetic and no scan. Zero-change currencies are omitted; an inverted
   * or unmatched range yields an empty map.
   */
  getBalanceChanges(
    accountPath: string,
    dateFrom: string,
    dateTo: string,
    options: Pick<RegisterOptions, 'includeDescendants'> = {}
  ): Map<string, MinorUnits> {
    const changes = new Map<string, MinorUnits>();
    if (!isValidAccountPath(accountPath) || dateTo < dateFrom) {
      return changes;
    }
    const index = this.getRegisterIndex(
      accountPath,
      options.includeDescendants === true
    );
    const endRow = this.findLastRowOnOrBefore(index, dateTo);
    if (endRow < 0) {
      return changes;
    }
    // Rows strictly before dateFrom: everything on or before it minus rows
    // dated exactly dateFrom and later — found as "last row before" via the
    // half-open property of the sorted date column.
    const beforeRow = this.findLastRowBefore(index, dateFrom);
    for (const [currency, sums] of index.prefixSumsByCurrency) {
      const change = sums[endRow] - (beforeRow < 0 ? 0 : sums[beforeRow]);
      if (change !== 0) {
        changes.set(currency, change);
      }
    }
    return changes;
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
    // Merge the sorted batch into the already-sorted list instead of
    // re-sorting the whole (growing) list — the difference between O(k log k)
    // and O(n log n) per chunk on a bulk ingest.
    this.entries = mergeSortedEntries(this.entries, added);
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

  /**
   * Greatest register row index whose entry date is `<= date`, or -1 when
   * every row is later. Register rows inherit the store's (date, id) order,
   * so the date column is non-decreasing and a plain binary search applies;
   * ISO dates compare correctly as strings.
   */
  private findLastRowOnOrBefore(index: RegisterIndex, date: string): number {
    let low = 0;
    let high = index.entryIndices.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.entries[index.entryIndices[mid]].date <= date) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }

  /** Greatest register row index whose entry date is strictly `< date`, or -1. */
  private findLastRowBefore(index: RegisterIndex, date: string): number {
    let low = 0;
    let high = index.entryIndices.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.entries[index.entryIndices[mid]].date < date) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
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
    const overflowCurrencies = new Set<string>();
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
      // A carry-forward running total can leave the safe-integer range even
      // when every posting is individually safe; flag the currency so the
      // overflow surfaces rather than silently poisoning the balance column.
      if (!Number.isSafeInteger(nextRunning)) {
        overflowCurrencies.add(posting.currency);
      }
      for (const [currency, currencySums] of prefixSumsByCurrency) {
        currencySums[row] = runningByCurrency.get(currency) ?? 0;
      }
    }

    return {
      entryIndices: Int32Array.from(entryIndices),
      postingIndices: Int32Array.from(postingIndices),
      prefixSumsByCurrency,
      overflowCurrencies,
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
