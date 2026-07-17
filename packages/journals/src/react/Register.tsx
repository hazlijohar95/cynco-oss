'use client';

import {
  Register as RegisterComponent,
  type RegisterOptions,
} from '../components/Register';
import { JOURNALS_TAG_NAME } from '../constants';
import type { ColorScheme, RegisterRowData } from '../types';
import { mergeColorSchemeStyle } from './utils/mergeColorSchemeStyle';
import { templateRender } from './utils/templateRender';
import { useJournalsInstance } from './utils/useJournalsInstance';

export interface RegisterProps {
  rows: readonly RegisterRowData[];
  options: RegisterOptions;
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
   * Shadow-root HTML from `preloadRegisterHTML`. Rendered as a declarative
   * shadow DOM template on the server; on the client the vanilla class
   * adopts the parsed shadow root and re-windows rows on the first
   * virtualized pass.
   */
  ssrHTML?: string;
}

export function Register({
  rows,
  options,
  colorScheme,
  className,
  style,
  ssrHTML,
}: RegisterProps): React.JSX.Element {
  const mergedOptions: RegisterOptions =
    colorScheme != null ? { ...options, colorScheme } : options;
  const { ref } = useJournalsInstance<RegisterComponent>({
    create(container) {
      const instance = new RegisterComponent(mergedOptions, true);
      instance.hydrate({ rows, container });
      return instance;
    },
    update(instance) {
      instance.setOptions(mergedOptions);
      instance.setRows(rows);
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
