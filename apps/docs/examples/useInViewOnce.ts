'use client';

import { useEffect, useRef, useState } from 'react';

// Defers expensive client-side work (workload generation, store indexing)
// until an element approaches the viewport. Fires once and disconnects; the
// generous rootMargin means data is usually ready before the user arrives.
// Falls back to immediate visibility when IntersectionObserver is missing.
export function useInViewOnce<T extends HTMLElement>(rootMargin = '400px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const element = ref.current;
    if (element == null || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}
