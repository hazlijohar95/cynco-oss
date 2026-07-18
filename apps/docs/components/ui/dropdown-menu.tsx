'use client';

import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import * as React from 'react';

import { cn } from '@/lib/utils';

// Lean dropdown wrappers over Base UI's Menu: an elevated popover surface
// with a hairline border and (per the design contract) the one sanctioned
// shadow. Items are 14px rows with 12px/6px padding and the accent tint on
// highlight/selection.

export const DropdownMenu = MenuPrimitive.Root;

// Keeps the Radix-style `asChild` call-site contract by translating it to
// Base UI's `render` prop, so triggers can stay `<DropdownMenuTrigger
// asChild><Button …/></DropdownMenuTrigger>`.
export function DropdownMenuTrigger({
  asChild = false,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Trigger> & {
  asChild?: boolean;
}) {
  if (asChild && React.isValidElement(children)) {
    return (
      <MenuPrimitive.Trigger
        render={children as React.ReactElement<Record<string, unknown>>}
        {...props}
      />
    );
  }
  return <MenuPrimitive.Trigger {...props}>{children}</MenuPrimitive.Trigger>;
}

export function DropdownMenuContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> & {
  align?: React.ComponentProps<typeof MenuPrimitive.Positioner>['align'];
  sideOffset?: React.ComponentProps<
    typeof MenuPrimitive.Positioner
  >['sideOffset'];
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        sideOffset={sideOffset}
        className="z-50 outline-none"
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            'bg-popover text-popover-foreground border-border-opaque z-50 min-w-[8rem] overflow-hidden rounded-md border bg-clip-padding p-1 shadow-lg dark:shadow-black/25',
            'data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  selected = false,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & {
  selected?: boolean;
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-selected={selected || undefined}
      className={cn(
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md px-3 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        selected && 'bg-accent text-accent-foreground',
        className
      )}
      {...props}
    />
  );
}
