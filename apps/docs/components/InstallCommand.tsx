'use client';

import { useEffect, useRef, useState } from 'react';

// Copy affordance for the install chip: faint copy glyph that swaps to the
// success green while the copied state is live.
function CopyStatus({ copied }: { copied: boolean }) {
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
        className="text-success shrink-0"
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
      className="text-text-weak shrink-0"
    >
      <rect x="9" y="9" width="11" height="11" />
      <path d="M5 15H4V4h11v1" />
    </svg>
  );
}

export interface InstallCommandProps {
  command: string;
}

// The hero's copy-to-clipboard chip, split out as the one client leaf so
// the rest of the hero stays a server component. The reset timer is held in
// a ref: rapid clicks replace (not stack) it, and unmount clears it.
export function InstallCommand({ command }: InstallCommandProps) {
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
      await navigator.clipboard.writeText(command);
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
        title="Copy to clipboard"
        className="bg-accent text-muted-foreground flex w-fit max-w-full cursor-pointer items-center gap-2 border-0 px-2 py-1 text-left text-[13px] leading-[1.3] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 sm:h-6 sm:overflow-hidden sm:py-0 sm:leading-[1.1] sm:whitespace-nowrap"
      >
        <span className="text-text-weak" aria-hidden="true">
          $
        </span>
        <span className="break-words sm:overflow-hidden sm:text-ellipsis">
          {command}
        </span>
        <CopyStatus copied={copied} />
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Install command copied to clipboard' : ''}
      </span>
    </>
  );
}
