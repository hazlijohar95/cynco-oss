// Internal helper shared by the time-sliced ingest paths
// (`EntryStore.addEntriesAsync`, `AccountStore.fromPathsAsync`): walks a sync
// or async source in fixed-size chunks so callers can apply one whole chunk
// atomically and yield to the event loop between chunks. Not exported from
// the package index — chunking is an ingest implementation detail, not API.
//
// Sync and async sources are branched explicitly instead of funnelling both
// through `for await`, which would award every element of a plain array its
// own microtask — a pointless per-row tax on the common 100k-entry case.

export async function* chunksOf<T>(
  source: Iterable<T> | AsyncIterable<T>,
  size: number
): AsyncGenerator<T[], void, void> {
  const chunkSize = Math.max(1, Math.floor(size));
  let chunk: T[] = [];
  if (Symbol.asyncIterator in source) {
    for await (const item of source) {
      chunk.push(item);
      if (chunk.length >= chunkSize) {
        yield chunk;
        chunk = [];
      }
    }
  } else {
    for (const item of source) {
      chunk.push(item);
      if (chunk.length >= chunkSize) {
        yield chunk;
        chunk = [];
      }
    }
  }
  if (chunk.length > 0) {
    yield chunk;
  }
}
