import type { VirtualWindowSpecs } from '../types';

export function areVirtualWindowSpecsEqual(
  a: VirtualWindowSpecs,
  b: VirtualWindowSpecs
): boolean {
  return a.top === b.top && a.bottom === b.bottom;
}
