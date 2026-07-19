'use client';

import {
  EntryDiff as EntryDiffComponent,
  type EntryDiffOptions,
} from '../components/EntryDiff';
import { JOURNALS_TAG_NAME } from '../constants';
import type { ColorScheme, LedgerEntry } from '../types';
import { mergeColorSchemeStyle } from './utils/mergeColorSchemeStyle';
import { templateRender } from './utils/templateRender';
import { useJournalsInstance } from './utils/useJournalsInstance';

export interface EntryDiffProps {
  /** Old version; null models entry creation (everything added). */
  before: LedgerEntry | null;
  /** New version; null models deletion/void (everything removed). */
  after: LedgerEntry | null;
  options?: EntryDiffOptions;
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
   * Shadow-root HTML from `preloadEntryDiffHTML`. Rendered as a declarative
   * shadow DOM template on the server; on the client the vanilla class
   * adopts the parsed shadow root without re-rendering.
   */
  ssrHTML?: string;
}

export function EntryDiff({
  before,
  after,
  options,
  colorScheme,
  className,
  style,
  ssrHTML,
}: EntryDiffProps): React.JSX.Element {
  const mergedOptions: EntryDiffOptions | undefined =
    colorScheme != null ? { ...options, colorScheme } : options;
  const { ref } = useJournalsInstance<EntryDiffComponent>({
    create(container) {
      const instance = new EntryDiffComponent(mergedOptions ?? {}, true);
      instance.hydrate({ before, after, container });
      return instance;
    },
    update(instance) {
      instance.setOptions(mergedOptions);
      instance.render({ before, after });
    },
    destroy(instance) {
      instance.cleanUp();
    },
  });
  return (
    <JOURNALS_TAG_NAME
      ref={ref}
      className={className}
      style={mergeColorSchemeStyle(colorScheme ?? options?.colorScheme, style)}
    >
      {templateRender(null, ssrHTML)}
    </JOURNALS_TAG_NAME>
  );
}
