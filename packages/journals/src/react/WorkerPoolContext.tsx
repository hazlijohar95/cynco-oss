'use client';

import { createContext, useContext } from 'react';

import type { WorkerPoolManager } from '../worker/WorkerPoolManager';

/**
 * Optional worker-pool context: components work without it (sync path).
 * Wrap a subtree in the provider and pass `useWorkerPool()` into component
 * options to move register windows and match proposals off the main thread.
 */
export const WorkerPoolContext: React.Context<WorkerPoolManager | null> =
  createContext<WorkerPoolManager | null>(null);

export interface WorkerPoolProviderProps {
  pool: WorkerPoolManager | null;
  children?: React.ReactNode;
}

export function WorkerPoolProvider({
  pool,
  children,
}: WorkerPoolProviderProps): React.JSX.Element {
  return (
    <WorkerPoolContext.Provider value={pool}>
      {children}
    </WorkerPoolContext.Provider>
  );
}

export function useWorkerPool(): WorkerPoolManager | null {
  return useContext(WorkerPoolContext);
}
