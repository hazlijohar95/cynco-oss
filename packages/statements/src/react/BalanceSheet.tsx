'use client';

import {
  BalanceSheet as BalanceSheetComponent,
  type BalanceSheetViewOptions,
} from '../components/BalanceSheet';
import { STATEMENTS_TAG_NAME } from '../constants';
import type { BalanceSheetData, ColorScheme } from '../types';
import { mergeColorSchemeStyle } from './utils/mergeColorSchemeStyle';
import { useStatementsInstance } from './utils/useStatementsInstance';

export interface BalanceSheetProps {
  data: BalanceSheetData;
  options?: BalanceSheetViewOptions;
  /**
   * Shorthand for `options.colorScheme` (see that field for the
   * light-dark()/user-preference pitfall). Also painted as an inline
   * `color-scheme` style on the custom element so server markup resolves to
   * the requested mode before the client render runs.
   */
  colorScheme?: ColorScheme;
  className?: string;
  style?: React.CSSProperties;
}

export function BalanceSheet({
  data,
  options,
  colorScheme,
  className,
  style,
}: BalanceSheetProps): React.JSX.Element {
  const mergedOptions: BalanceSheetViewOptions | undefined =
    colorScheme != null ? { ...options, colorScheme } : options;
  const { ref } = useStatementsInstance<BalanceSheetComponent>({
    create(container) {
      const instance = new BalanceSheetComponent(mergedOptions ?? {}, true);
      instance.render({ data, container });
      return instance;
    },
    update(instance) {
      instance.setOptions(mergedOptions);
      instance.render({ data });
    },
    destroy(instance) {
      instance.cleanUp();
    },
  });
  return (
    <STATEMENTS_TAG_NAME
      ref={ref}
      className={className}
      style={mergeColorSchemeStyle(colorScheme ?? options?.colorScheme, style)}
    />
  );
}
