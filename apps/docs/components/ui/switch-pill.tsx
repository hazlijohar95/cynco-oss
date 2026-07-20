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
// switch stacked into its right padding via the one-cell grid. The switch
// is the single accessible control (role switch, named by the label); the
// button is a visual click-extender hidden from the tab order and the
// accessibility tree so keyboard users hit each pill exactly once. The two
// are grid siblings — the switch's click never bubbles into the button, so
// no double-fire guard is needed.
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
        tabIndex={-1}
        aria-hidden="true"
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
        aria-label={label}
        className="mr-3 self-center justify-self-end"
      />
    </div>
  );
}
