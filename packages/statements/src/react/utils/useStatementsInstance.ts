import { useEffect, useLayoutEffect, useRef } from 'react';

import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface StatementsInstanceAdapter<Instance> {
  /**
   * Called once when the custom element mounts. Should construct the vanilla
   * instance and render it into the container.
   */
  create(container: HTMLElement): Instance;
  /** Called on every committed React render to sync props into the instance. */
  update(instance: Instance): void;
  /** Called when the custom element unmounts. */
  destroy(instance: Instance): void;
}

export interface UseStatementsInstanceReturn {
  ref(node: HTMLElement | null): void;
}

// Shared lifecycle glue for the thin React wrappers: a <statements-container>
// ref callback owns exactly one vanilla component instance, and a layout
// effect pushes prop changes into it after every render. All rendering logic
// stays in the vanilla classes — React only manages lifetime.
export function useStatementsInstance<Instance>(
  adapter: StatementsInstanceAdapter<Instance>
): UseStatementsInstanceReturn {
  const instanceRef = useRef<Instance | null>(null);
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  const ref = useStableCallback((container: HTMLElement | null) => {
    if (container != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'useStatementsInstance: An instance should not already exist when a node is created'
        );
      }
      instanceRef.current = adapterRef.current.create(container);
    } else {
      if (instanceRef.current == null) {
        throw new Error(
          'useStatementsInstance: An instance should exist when unmounting'
        );
      }
      adapterRef.current.destroy(instanceRef.current);
      instanceRef.current = null;
    }
  });

  useIsometricEffect(() => {
    const { current: instance } = instanceRef;
    if (instance == null) return;
    adapterRef.current.update(instance);
  });

  return { ref };
}
