'use client';

import { Children, type ReactNode, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export interface CodeTabsProps {
  /** One label per child, in order — e.g. ['Vanilla', 'SSR']. */
  labels: readonly string[];
  children: ReactNode;
}

// Tab strip for parallel code variants (vanilla / React / SSR of the same
// thing). The panels arrive as server-rendered children — every variant is
// present in the static HTML and inactive ones are `hidden` — so this client
// component owns only the selection state. Keyboard follows the ARIA tabs
// pattern: one roving tab stop, arrows move AND activate (panels are
// prerendered, so activation is free), Home/End jump.
export function CodeTabs({ labels, children }: CodeTabsProps) {
  const [selected, setSelected] = useState(0);
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panels = Children.toArray(children);

  const selectAndFocus = (index: number) => {
    const clamped = (index + labels.length) % labels.length;
    setSelected(clamped);
    tabRefs.current[clamped]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowRight':
        selectAndFocus(selected + 1);
        break;
      case 'ArrowLeft':
        selectAndFocus(selected - 1);
        break;
      case 'Home':
        selectAndFocus(0);
        break;
      case 'End':
        selectAndFocus(labels.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="code-tabs">
      <div
        role="tablist"
        aria-label="Code variants"
        className="flex items-center gap-1 font-mono"
        onKeyDown={onKeyDown}
      >
        {labels.map((label, index) => (
          <button
            key={label}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${index}`}
            aria-selected={index === selected}
            aria-controls={`${baseId}-panel-${index}`}
            tabIndex={index === selected ? 0 : -1}
            onClick={() => setSelected(index)}
            className={cn(
              'text-muted-foreground hover:text-foreground h-7 cursor-pointer rounded-md px-3 text-[13px] leading-none transition-[color,background-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-[-2px]',
              index === selected && 'text-foreground bg-muted font-medium'
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {panels.map((panel, index) => (
        <div
          // Panel order is fixed at authoring time; the index is the key.
          key={index}
          role="tabpanel"
          id={`${baseId}-panel-${index}`}
          aria-labelledby={`${baseId}-tab-${index}`}
          hidden={index !== selected}
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
