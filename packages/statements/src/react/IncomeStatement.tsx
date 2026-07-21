'use client';

import {
  IncomeStatement as IncomeStatementComponent,
  type IncomeStatementViewOptions,
} from '../components/IncomeStatement';
import { STATEMENTS_TAG_NAME } from '../constants';
import type { ColorScheme, IncomeStatementData } from '../types';
import { mergeColorSchemeStyle } from './utils/mergeColorSchemeStyle';
import { useStatementsInstance } from './utils/useStatementsInstance';

export interface IncomeStatementProps {
  data: IncomeStatementData;
  options?: IncomeStatementViewOptions;
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

export function IncomeStatement({
  data,
  options,
  colorScheme,
  className,
  style,
}: IncomeStatementProps): React.JSX.Element {
  const mergedOptions: IncomeStatementViewOptions | undefined =
    colorScheme != null ? { ...options, colorScheme } : options;
  const { ref } = useStatementsInstance<IncomeStatementComponent>({
    create(container) {
      const instance = new IncomeStatementComponent(mergedOptions ?? {}, true);
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
