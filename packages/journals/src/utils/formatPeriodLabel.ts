const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const YEAR_KEY = /^\d{4}$/;
const QUARTER_KEY = /^(\d{4})-Q([1-4])$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;

// Formats a deterministic period key (`2026`, `2026-Q1`, `2026-03`) into the
// locale-free English label the group header renders ("2026", "Q1 2026",
// "March 2026"). Like the rest of the library the output is deterministic
// English, never Intl — SSR, worker, and client must produce identical
// bytes. Unrecognized keys (malformed dates upstream) return the key itself
// so bad input renders legibly instead of throwing.
export function formatPeriodLabel(key: string): string {
  if (YEAR_KEY.test(key)) {
    return key;
  }
  const quarter = QUARTER_KEY.exec(key);
  if (quarter != null) {
    return `Q${quarter[2]} ${quarter[1]}`;
  }
  const month = MONTH_KEY.exec(key);
  if (month != null) {
    const monthNumber = Number(month[2]);
    if (monthNumber >= 1 && monthNumber <= 12) {
      return `${MONTH_NAMES[monthNumber - 1]} ${month[1]}`;
    }
  }
  return key;
}
