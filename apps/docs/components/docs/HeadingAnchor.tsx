'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export interface HeadingAnchorProps {
  /** The heading's id (authored `{#id}` markers via rehype-docs). */
  id: string;
}

// Hover/focus-revealed deep-link affordance rendered inside every
// identified h2/h3 (mdx-components.tsx). Clicking copies the section URL
// and moves the address-bar hash via replaceState — no scroll jump, no
// history entry per click. Absolutely positioned into the heading's left
// gutter (prose.css .heading-anchor) so revealing it never shifts text.
// The glyph is decorative; the button name carries the semantics. Reset
// timer follows the CopyButton pattern: rapid clicks replace it, unmount
// clears it.
export function HeadingAnchor({ id }: HeadingAnchorProps) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const copyLink = async () => {
    const hash = `#${id}`;
    history.replaceState(null, '', hash);
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${window.location.pathname}${hash}`
      );
      setCopied(true);
      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy section link', err);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Copy link to section"
        title="Copy link to section"
        data-print-hidden
        className={cn('heading-anchor', copied && 'is-copied')}
        onClick={() => void copyLink()}
      >
        <span aria-hidden="true">{copied ? '✓' : '#'}</span>
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Section link copied' : ''}
      </span>
    </>
  );
}
