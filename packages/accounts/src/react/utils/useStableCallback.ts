import { useCallback, useRef } from 'react';

// Returns a referentially stable function that always invokes the latest
// callback. Used for ref callbacks that must not change identity between
// renders (React would tear down and recreate the vanilla instance).
export function useStableCallback<Args extends unknown[], Return>(
  callback: (...args: Args) => Return
): (...args: Args) => Return {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}
