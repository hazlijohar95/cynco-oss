'use client';

import type { Register } from '@cynco/journals';
import { type RefObject, useEffect } from 'react';

// Auto-scroll stress cadence. The smooth-scroll spring settles in ~440ms,
// so a 600ms period keeps the register in continuous motion without
// stacking retargets faster than the spring can express them.
export const STRESS_INTERVAL_MS = 600;

// Auto-scroll stress test: jump the smooth-scroll spring to a random row on
// a fixed cadence. Random targets defeat any locality the row window could
// exploit, so every tick is a cold window render — the worst case the
// worker pool exists for. prefers-reduced-motion turns each glide into an
// instant jump inside the spring itself.
export function useStressScroll(
  registerRef: RefObject<Register | null>,
  rowCount: number,
  running: boolean
): void {
  useEffect(() => {
    if (!running || rowCount === 0) return;
    const interval = window.setInterval(() => {
      registerRef.current?.scrollToRow(Math.floor(Math.random() * rowCount), {
        align: 'start',
        behavior: 'smooth',
      });
    }, STRESS_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [registerRef, rowCount, running]);
}
