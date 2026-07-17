import { useEffect, useLayoutEffect, useRef } from 'react';

import { useStableCallback } from './useStableCallback';

const useIsometricEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface JournalsInstanceAdapter<Instance> {
  /**
   * Called once when the custom element mounts. Should construct the vanilla
   * instance and hydrate/render it into the container (which may already
   * carry an SSR declarative shadow root).
   */
  create(container: HTMLElement): Instance;
  /** Called on every committed React render to sync props into the instance. */
  update(instance: Instance): void;
  /** Called when the custom element unmounts. */
  destroy(instance: Instance): void;
}

export interface UseJournalsInstanceReturn {
  ref(node: HTMLElement | null): void;
}

// Shared lifecycle glue for the thin React wrappers: a <journals-container>
// ref callback owns exactly one vanilla component instance, and a layout
// effect pushes prop changes into it after every render. All rendering logic
// stays in the vanilla classes — React only manages lifetime.
export function useJournalsInstance<Instance>(
  adapter: JournalsInstanceAdapter<Instance>
): UseJournalsInstanceReturn {
  const instanceRef = useRef<Instance | null>(null);
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  const ref = useStableCallback((container: HTMLElement | null) => {
    if (container != null) {
      if (instanceRef.current != null) {
        throw new Error(
          'useJournalsInstance: An instance should not already exist when a node is created'
        );
      }
      instanceRef.current = adapterRef.current.create(container);
    } else {
      if (instanceRef.current == null) {
        throw new Error(
          'useJournalsInstance: An instance should exist when unmounting'
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
