'use client';

import {
  Reconciliation as ReconciliationComponent,
  type ReconciliationOptions,
} from '../components/Reconciliation';
import { JOURNALS_TAG_NAME } from '../constants';
import type { ColorScheme } from '../types';
import { mergeColorSchemeStyle } from './utils/mergeColorSchemeStyle';
import { templateRender } from './utils/templateRender';
import { useJournalsInstance } from './utils/useJournalsInstance';

export interface ReconciliationProps {
  options: ReconciliationOptions;
  /**
   * Shorthand for `options.colorScheme` (see that field for the
   * light-dark()/user-preference pitfall). Also painted as an inline
   * `color-scheme` style on the custom element so SSR markup resolves to the
   * requested mode before hydration runs.
   */
  colorScheme?: ColorScheme;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Shadow-root HTML from `preloadReconciliationHTML`. Rendered as a
   * declarative shadow DOM template on the server; on the client the vanilla
   * class adopts the parsed shadow root without re-rendering.
   */
  ssrHTML?: string;
}

export function Reconciliation({
  options,
  colorScheme,
  className,
  style,
  ssrHTML,
}: ReconciliationProps): React.JSX.Element {
  const mergedOptions: ReconciliationOptions =
    colorScheme != null ? { ...options, colorScheme } : options;
  const { ref } = useJournalsInstance<ReconciliationComponent>({
    create(container) {
      const instance = new ReconciliationComponent(mergedOptions, true);
      instance.hydrate({ container });
      return instance;
    },
    update(instance) {
      instance.setOptions(mergedOptions);
    },
    destroy(instance) {
      instance.cleanUp();
    },
  });
  return (
    <JOURNALS_TAG_NAME
      ref={ref}
      className={className}
      style={mergeColorSchemeStyle(colorScheme ?? options.colorScheme, style)}
    >
      {templateRender(null, ssrHTML)}
    </JOURNALS_TAG_NAME>
  );
}
