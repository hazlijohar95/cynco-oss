'use client';

import { ACCOUNTS_TAG_NAME } from '../constants';
import type { AccountTreeOptions } from '../render/AccountTree';
import type { ColorScheme } from '../types';
import { useAccountTree } from './useAccountTree';
import { mergeColorSchemeStyle } from './utils/mergeColorSchemeStyle';
import { templateRender } from './utils/templateRender';

export interface AccountTreeProps {
  options: AccountTreeOptions;
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
   * Shadow-root HTML from `preloadAccountTreeHTML`. Rendered as a
   * declarative shadow DOM template on the server; on the client the vanilla
   * class adopts the parsed shadow root and re-windows rows on the first
   * scroll.
   */
  ssrHTML?: string;
}

export function AccountTree({
  options,
  colorScheme,
  className,
  style,
  ssrHTML,
}: AccountTreeProps): React.JSX.Element {
  const mergedOptions: AccountTreeOptions =
    colorScheme != null ? { ...options, colorScheme } : options;
  const { ref } = useAccountTree(mergedOptions);
  return (
    <ACCOUNTS_TAG_NAME
      ref={ref}
      className={className}
      style={mergeColorSchemeStyle(colorScheme ?? options.colorScheme, style)}
    >
      {templateRender(null, ssrHTML)}
    </ACCOUNTS_TAG_NAME>
  );
}
