'use client';

import type { Register, RowRange } from '@cynco/journals';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useState,
} from 'react';

import { acquireWorkerPool, describePool } from './workerPool';

// Rendered-window poll period. getRenderedRange() is a field read, so
// polling is nearly free; 250ms is fast enough to feel live while scrolling.
const STATS_POLL_MS = 250;

export interface RenderedRangePoll {
  windowRange: RowRange | null;
  poolReadout: string | null;
  /** Exposed so the register mount effect can seed the readout the moment
   * a pool is (or isn't) acquired, ahead of the first poll tick. */
  setPoolReadout: Dispatch<SetStateAction<string | null>>;
}

// Live rendered-window readout: getRenderedRange() is a plain field read
// exposed by the register, polled instead of evented (the component has no
// window-rendered callback). State only updates when the range moved, so
// idle polling causes zero re-renders — and ticks skip entirely while the
// tab is hidden, so a backgrounded lab does no work at all.
export function useRenderedRangePoll(
  registerRef: RefObject<Register | null>,
  active: boolean,
  poolEnabled: boolean
): RenderedRangePoll {
  const [windowRange, setWindowRange] = useState<RowRange | null>(null);
  const [poolReadout, setPoolReadout] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setWindowRange(null);
      return;
    }
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      const range = registerRef.current?.getRenderedRange();
      setWindowRange((previous) => {
        if (range == null) return previous;
        if (
          previous != null &&
          previous.start === range.start &&
          previous.end === range.end
        ) {
          return previous;
        }
        return { start: range.start, end: range.end };
      });
      if (poolEnabled) {
        const readout = describePool(acquireWorkerPool());
        setPoolReadout((previous) =>
          previous === readout ? previous : readout
        );
      }
    }, STATS_POLL_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [registerRef, active, poolEnabled]);

  return { windowRange, poolReadout, setPoolReadout };
}
