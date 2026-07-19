import type {
  MinorUnits,
  RegisterGroupBy,
  RegisterRowData,
  RegisterVirtualRow,
} from '../types';
import { formatPeriodLabel } from './formatPeriodLabel';
import { getRegisterPeriodKey } from './getRegisterPeriodKey';

// Group summaries are mutated while the single pass scans their rows; the
// public RegisterGroupSummary shape they satisfy is read-only to consumers.
interface MutableGroupSummary {
  key: string;
  label: string;
  entryCount: number;
  netChange: Map<string, MinorUnits>;
}

// Builds the grouped register row model: a flat sequence of group headers
// and entry rows in one O(n) pass. Rows are already date-sorted (the data
// layer's contract), so a group boundary is simply a period-key change
// between adjacent rows; out-of-order dates degrade gracefully into repeated
// headers rather than being re-sorted or repaired. Dates are ISO strings, so
// period keys are substring/arithmetic work — no Date parsing, no timezones.
// `entryIndex` on entry rows is the index into the ORIGINAL rows array so
// selection and `data-row-index` stay in entry space.
export function buildRegisterRowModel(
  rows: readonly RegisterRowData[],
  groupBy: Exclude<RegisterGroupBy, 'none'>
): RegisterVirtualRow[] {
  const model: RegisterVirtualRow[] = [];
  let currentKey: string | null = null;
  let currentGroup: MutableGroupSummary | null = null;
  let currentEntryIds: Set<string> | null = null;
  for (const [entryIndex, row] of rows.entries()) {
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
    // Distinct entry ids, not row count: an entry hitting the account with
    // two postings contributes two rows but is still one entry.
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
