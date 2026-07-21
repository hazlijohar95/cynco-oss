import { AMOUNT_FORMAT_COMMA_DOT } from '../constants';
import type { AmountFormat } from '../types';

/**
 * Maps a BCP 47 locale tag to an {@link AmountFormat} descriptor by probing
 * `Intl.NumberFormat.formatToParts` ONCE.
 *
 * HOST-SIDE ONLY — never call this from a renderer or ssr module
 * (and none of them import this file). ICU data differs across Node
 * versions and browsers, so the same locale can resolve to different
 * separators on server and client; calling Intl inside a render path would
 * therefore break the SSR/client byte-parity contract. The supported
 * pattern is: the host resolves a descriptor wherever it owns the user's
 * locale preference, keeps the resulting PLAIN DATA (it survives JSON and
 * structured clone), and passes that same object to every render surface —
 * one Intl call, identical bytes everywhere.
 *
 * Unknown locales, grouping-free locales, and environments without Intl all
 * degrade gracefully instead of throwing: the fallback is the default
 * `1,234.56` descriptor.
 */
export function resolveAmountFormat(locale: string): AmountFormat {
  try {
    // 123456789.1 crosses two group boundaries under [3]-grouping and three
    // under Indian [3,2] grouping, and the forced single fraction digit
    // guarantees a decimal-separator part. Probe value only — it never
    // touches ledger amounts, which stay integer minor units end to end.
    const parts = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: true,
    }).formatToParts(123456789.1);
    const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';
    const group = parts.find((part) => part.type === 'group')?.value ?? '';
    if (group === '') {
      // Locales that do not group integer digits: say so honestly rather
      // than inventing Western thousands.
      return { decimal, group: '', groupSizes: [] };
    }
    // Digit-run lengths right-to-left give the group sizes from the decimal
    // point outward. The leftmost run is dropped — it is a remainder, not a
    // group size (1,234,567 leads with "1") — and consecutive repeats
    // collapse because the descriptor's last size repeats by contract:
    // [3,3] → [3], [3,2,2] → [3,2].
    const runs = parts
      .filter((part) => part.type === 'integer')
      .map((part) => part.value.length)
      .reverse()
      .slice(0, -1);
    const groupSizes: number[] = [];
    for (const size of runs) {
      if (groupSizes[groupSizes.length - 1] !== size) {
        groupSizes.push(size);
      }
    }
    return {
      decimal,
      group,
      groupSizes: groupSizes.length > 0 ? groupSizes : [3],
    };
  } catch {
    return AMOUNT_FORMAT_COMMA_DOT;
  }
}
