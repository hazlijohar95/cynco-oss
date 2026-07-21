/**
 * FNV-1a 32-bit hash, hex-encoded. CSV rows have no bank-issued transaction
 * id (unlike OFX's FITID), so statement-line ids are derived from the row's
 * own raw text: pure string arithmetic, no randomness, no timestamps — the
 * same file parsed twice yields byte-identical ids, which is what lets a
 * host re-run an import idempotently and dedupe against earlier runs. FNV-1a
 * is enough because ids only need stability plus a per-file occurrence
 * counter for identical rows (see parseCsvStatement), not cryptographic
 * collision resistance.
 */
export function hashLine(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
