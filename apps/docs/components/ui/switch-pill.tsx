'use client';

import type { ReactNode } from 'react';

import { Button } from './button';
import { Switch } from './switch';

export interface SwitchPillProps {
  /** Leading icon rendered before the label. */
  icon?: ReactNode;
  label: string;
  checked: boolean;
  onCheckedChange(checked: boolean): void;
}

// Toggle pill: an outline button carrying the icon + label with the small
// switch stacked into its right padding via the one-cell grid, so the whole
// pill is one 36px-tall hit target. Clicking either the pill or the knob
// flips the same state; stopPropagation keeps the two from double-firing.
export function SwitchPill({
  icon,
  label,
  checked,
  onCheckedChange,
}: SwitchPillProps) {
  return (
    <div className="gridstack">
      <Button
        variant="outline"
        className="w-full justify-between gap-3 pr-11 pl-3 md:w-auto"
        onClick={() => onCheckedChange(!checked)}
      >
        <div className="flex items-center gap-2">
          {icon}
          {label}
        </div>
      </Button>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        onClick={(event) => event.stopPropagation()}
        aria-label={label}
        className="mr-3 self-center justify-self-end"
      />
    </div>
  );
}
