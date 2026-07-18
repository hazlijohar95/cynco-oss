import type { LedgerEntry } from '../types';

export interface CreateEntryStreamFromArrayOptions {
  /**
   * Milliseconds between entries. Default 0 (entries are still delivered
   * asynchronously, one microtask apart, so consumers exercise their real
   * streaming path).
   */
  delayMs?: number;
}

// Test/demo helper: turns a plain array into a ReadableStream<LedgerEntry>
// with an optional fixed cadence. Cancellation stops the timer chain so
// EntryStream.cleanUp() genuinely halts production.
export function createEntryStreamFromArray(
  entries: readonly LedgerEntry[],
  options: CreateEntryStreamFromArrayOptions = {}
): ReadableStream<LedgerEntry> {
  const { delayMs = 0 } = options;
  let index = 0;
  let canceled = false;
  return new ReadableStream<LedgerEntry>({
    async pull(controller) {
      if (canceled) {
        return;
      }
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (canceled) {
        return;
      }
      if (index >= entries.length) {
        controller.close();
        return;
      }
      controller.enqueue(entries[index]);
      index += 1;
    },
    cancel() {
      canceled = true;
    },
  });
}
