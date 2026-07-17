'use client';

import {
  JournalEntry as JournalEntryComponent,
  type JournalEntryOptions,
} from '../components/JournalEntry';
import { JOURNALS_TAG_NAME } from '../constants';
import type { LedgerEntry } from '../types';
import { templateRender } from './utils/templateRender';
import { useJournalsInstance } from './utils/useJournalsInstance';

export interface JournalEntryProps {
  entry: LedgerEntry;
  options?: JournalEntryOptions;
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
  className,
  style,
  ssrHTML,
}: JournalEntryProps): React.JSX.Element {
  const { ref } = useJournalsInstance<JournalEntryComponent>({
    create(container) {
      const instance = new JournalEntryComponent(options ?? {}, true);
      instance.hydrate({ entry, container });
      return instance;
    },
    update(instance) {
      instance.setOptions(options);
      instance.render({ entry });
    },
    destroy(instance) {
      instance.cleanUp();
    },
  });
  return (
    <JOURNALS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(null, ssrHTML)}
    </JOURNALS_TAG_NAME>
  );
}
