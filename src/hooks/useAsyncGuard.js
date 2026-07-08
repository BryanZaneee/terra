import { useEffect, useRef } from 'react';

/**
 * Returns a stable `isActive()` guard for async work. Resets to true on every
 * mount (including React StrictMode remount) so post-await setState is safe.
 */
export function useAsyncGuard() {
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  return activeRef;
}
