'use client';

import * as React from 'react';

import { Button, type ButtonProps } from './button';
import { cn } from '@/lib/utils';

// Segmented control: a secondary-tinted pill container where the selected
// segment renders as an outline button (background surface + hairline
// border) and the rest as muted ghost buttons. Metrics match the probed
// reference bars: 36px tall, 10px container radius, 9px segment radius,
// 8px/14px segment padding, 14px medium text, 6px icon gap.
//
// The public API is generic over the value union so call sites get a typed
// onValueChange with no casts; the context stays string-based internally.

interface ButtonGroupContextValue {
  selectedValue?: string;
  onValueChange?: (value: string) => void;
  size?: ButtonProps['size'];
}

const ButtonGroupContext = React.createContext<ButtonGroupContextValue>({});

export interface ButtonGroupProps<T extends string> extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onChange'
> {
  value?: T;
  onValueChange?: (value: T) => void;
  size?: ButtonProps['size'];
  children: React.ReactNode;
}

export function ButtonGroup<T extends string>({
  className,
  value,
  onValueChange,
  size,
  children,
  ...props
}: ButtonGroupProps<T>) {
  return (
    <ButtonGroupContext.Provider
      value={{
        selectedValue: value,
        // Item values are authored to match the group's union, so widening
        // the callback through the string-typed context is sound.
        onValueChange: onValueChange as ((value: string) => void) | undefined,
        size,
      }}
    >
      <div
        className={cn(
          'bg-secondary inline-flex self-start rounded-lg',
          className
        )}
        role="group"
        {...props}
      >
        {children}
      </div>
    </ButtonGroupContext.Provider>
  );
}

export interface ButtonGroupItemProps extends Omit<ButtonProps, 'variant'> {
  value: string;
  children: React.ReactNode;
}

export function ButtonGroupItem({
  className,
  value,
  children,
  onClick,
  ...props
}: ButtonGroupItemProps) {
  const context = React.useContext(ButtonGroupContext);
  const isSelected = context.selectedValue === value;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    context.onValueChange?.(value);
    onClick?.(event);
  };

  return (
    <Button
      className={cn(
        'text-muted-foreground gap-1.5 rounded-[calc(var(--radius-lg)-1px)]',
        isSelected && 'text-foreground pointer-events-none',
        className
      )}
      variant={isSelected ? 'outline' : 'ghost'}
      size={context.size}
      onClick={handleClick}
      aria-pressed={isSelected}
      {...props}
    >
      {children}
    </Button>
  );
}
