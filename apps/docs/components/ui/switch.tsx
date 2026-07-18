'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import * as React from 'react';

import { cn } from '@/lib/utils';

// Small iOS-style switch matching the probed reference metrics: 24×16px
// track (h-4 w-6, rounded-full, 2px transparent border), 12px thumb that
// translates 8px when checked, 150ms color/transform transitions. Checked
// track reads primary; unchecked reads the input tint. Built on Base UI,
// which exposes state as data-checked/data-unchecked attributes.
export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer focus-visible:ring-ring focus-visible:ring-offset-background data-[checked]:bg-primary data-[unchecked]:bg-input inline-flex h-4 w-6 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-background pointer-events-none block h-3 w-3 rounded-full ring-0 transition-transform data-[checked]:translate-x-2 data-[unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}
