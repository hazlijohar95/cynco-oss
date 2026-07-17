'use client';

import {
  JournalEntry as JournalEntryComponent,
  type JournalEntryOptions,
} from '../components/JournalEntry';
import { JOURNALS_TAG_NAME } from '../constants';
import type { ColorScheme, LedgerEntry } from '../types';
import { mergeColorSchemeStyle } from './utils/mergeColorSchemeStyle';
import { templateRender } from './utils/templateRender';
import { useJournalsInstance } from './utils/useJournalsInstance';

export interface JournalEntryProps {
  entry: LedgerEntry;
  options?: JournalEntryOptions;
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
   * Shadow-root HTML from `preloadJournalEntryHTML`. Rendered as a
   * declarative shadow DOM template on the server; on the client the vanilla
   * class adopts the parsed shadow root without re-rendering.
   */
  ssrHTML?: string;
}

export function JournalEntry({
  entry,
  options,
  colorScheme,
  className,
  style,
  ssrHTML,
}: JournalEntryProps): React.JSX.Element {
  const mergedOptions: JournalEntryOptions | undefined =
    colorScheme != null ? { ...options, colorScheme } : options;
  const { ref } = useJournalsInstance<JournalEntryComponent>({
    create(container) {
      const instance = new JournalEntryComponent(mergedOptions ?? {}, true);
      instance.hydrate({ entry, container });
      return instance;
    },
    update(instance) {
      instance.setOptions(mergedOptions);
      instance.render({ entry });
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
