'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

// Same glyph pair as InstallCommand's CopyStatus: faint copy squares that
// swap to the success check while the copied state is live.
function CopyGlyph({ copied }: { copied: boolean }) {
  if (copied) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        aria-hidden="true"
        className="text-success"
      >
        <path d="M5 12.5L10 17.5L19 7" />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="11" height="11" />
      <path d="M5 15H4V4h11v1" />
    </svg>
  );
}

export interface CopyButtonProps {
  /** The exact text written to the clipboard. */
  text: string;
  className?: string;
}

// Copy-to-clipboard leaf for code blocks — the one client boundary inside
// the otherwise server-rendered CodeBlock. Follows the InstallCommand
// pattern: the reset timer lives in a ref so rapid clicks replace (not
// stack) it, and unmount clears it.
export function CopyButton({ text, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void copyToClipboard()}
        aria-label="Copy code"
        title="Copy to clipboard"
        className={cn(
          'text-text-weak hover:text-foreground flex h-6 w-6 cursor-pointer items-center justify-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
          className
        )}
      >
        <CopyGlyph copied={copied} />
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Code copied to clipboard' : ''}
      </span>
    </>
  );
}
