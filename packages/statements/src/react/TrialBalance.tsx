'use client';

import {
  TrialBalance as TrialBalanceComponent,
  type TrialBalanceViewOptions,
} from '../components/TrialBalance';
import { STATEMENTS_TAG_NAME } from '../constants';
import type { ColorScheme, TrialBalanceData } from '../types';
import { mergeColorSchemeStyle } from './utils/mergeColorSchemeStyle';
import { useStatementsInstance } from './utils/useStatementsInstance';

export interface TrialBalanceProps {
  data: TrialBalanceData;
  options?: TrialBalanceViewOptions;
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

export function TrialBalance({
  data,
  options,
  colorScheme,
  className,
  style,
}: TrialBalanceProps): React.JSX.Element {
  const mergedOptions: TrialBalanceViewOptions | undefined =
    colorScheme != null ? { ...options, colorScheme } : options;
  const { ref } = useStatementsInstance<TrialBalanceComponent>({
    create(container) {
      const instance = new TrialBalanceComponent(mergedOptions ?? {}, true);
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
