import type { RegisterVirtualRow } from '../types';

// Precomputes cumulative pixel offsets for a grouped row model:
// offsets[i] is the top of model row i relative to the register body,
// offsets[length] is the total body height. Built once per data update so
// windowing stays O(log n) (binary search over this array) instead of
// walking mixed-height rows per scroll frame. Float64Array keeps the hot
// array flat and monomorphic; heights are integer px so sums stay exact.
export function computeRowModelOffsets(
  model: readonly RegisterVirtualRow[],
  entryRowHeight: number,
  groupRowHeight: number
): Float64Array {
  const offsets = new Float64Array(model.length + 1);
  let offset = 0;
  for (let index = 0; index < model.length; index += 1) {
    offsets[index] = offset;
    offset += model[index].kind === 'group' ? groupRowHeight : entryRowHeight;
  }
  offsets[model.length] = offset;
  return offsets;
}
