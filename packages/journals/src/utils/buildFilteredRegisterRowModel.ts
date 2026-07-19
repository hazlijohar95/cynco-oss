import type {
  MinorUnits,
  RegisterGroupBy,
  RegisterRowData,
  RegisterVirtualRow,
} from '../types';
import { formatPeriodLabel } from './formatPeriodLabel';
import { getRegisterPeriodKey } from './getRegisterPeriodKey';

// Mutated while the single pass scans matched rows; read-only to consumers
// through the public RegisterGroupSummary shape (same as the full builder).
interface MutableGroupSummary {
  key: string;
  label: string;
  entryCount: number;
  netChange: Map<string, MinorUnits>;
}

// Builds the FILTERED register row model from precomputed matched entry
// indexes (see computeRegisterFilterMatches): matched entry rows only, each
// keeping its ORIGINAL entry index — the filter changes which rows are
// visible, never their identity, so selection, callbacks, and row ids stay
// in full-data space. With `groupBy` active, group headers survive only for
// periods containing at least one match, and their entry-count / net-change
// summaries are recomputed over the MATCHED rows (integer minor-unit math).
// That is deliberate honesty, not laziness: a period header claiming the
// period's FULL totals above a filtered subset of its rows would misstate
// what the grid presents — in an accounting UI the summary must describe
// what's shown. groupBy 'none' returns plain entry rows (the flat register
// reuses the model-window machinery whenever a filter is active).
export function buildFilteredRegisterRowModel(
  rows: readonly RegisterRowData[],
  groupBy: RegisterGroupBy,
  matchedEntryIndexes: readonly number[]
): RegisterVirtualRow[] {
  const model: RegisterVirtualRow[] = [];
  if (groupBy === 'none') {
    for (const entryIndex of matchedEntryIndexes) {
      model.push({ kind: 'entry', row: rows[entryIndex], entryIndex });
    }
    return model;
  }
  // Same single O(matches) pass as buildRegisterRowModel: matched rows stay
  // in date order (matches are ascending over date-sorted rows), so a group
  // boundary is a period-key change between adjacent MATCHED rows.
  let currentKey: string | null = null;
  let currentGroup: MutableGroupSummary | null = null;
  let currentEntryIds: Set<string> | null = null;
  for (const entryIndex of matchedEntryIndexes) {
    const row = rows[entryIndex];
    const key = getRegisterPeriodKey(row.entry.date, groupBy);
    if (key !== currentKey || currentGroup == null) {
      currentKey = key;
      currentGroup = {
        key,
        label: formatPeriodLabel(key),
        entryCount: 0,
        netChange: new Map(),
      };
      currentEntryIds = new Set();
      model.push({ kind: 'group', group: currentGroup });
    }
    // Distinct entry ids among the MATCHES, mirroring the full builder's
    // distinct-entry rule over its rows.
    if (currentEntryIds != null && !currentEntryIds.has(row.entry.id)) {
      currentEntryIds.add(row.entry.id);
      currentGroup.entryCount += 1;
    }
    const { amount, currency } = row.posting;
    currentGroup.netChange.set(
      currency,
      (currentGroup.netChange.get(currency) ?? 0) + amount
    );
    model.push({ kind: 'entry', row, entryIndex });
  }
  return model;
}
