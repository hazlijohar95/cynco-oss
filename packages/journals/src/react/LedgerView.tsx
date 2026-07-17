'use client';

import {
  type LedgerSection,
  LedgerView as LedgerViewComponent,
  type LedgerViewOptions,
} from '../components/LedgerView';
import { JOURNALS_TAG_NAME } from '../constants';
import { useJournalsInstance } from './utils/useJournalsInstance';

export interface LedgerViewProps {
  sections: readonly LedgerSection[];
  options?: LedgerViewOptions;
  className?: string;
  style?: React.CSSProperties;
}

export function LedgerView({
  sections,
  options,
  className,
  style,
}: LedgerViewProps): React.JSX.Element {
  const { ref } = useJournalsInstance<LedgerViewComponent>({
    create(container) {
      const instance = new LedgerViewComponent(options ?? {}, true);
      instance.render({ sections, container });
      return instance;
    },
    update(instance) {
      instance.setOptions(options);
      instance.setSections(sections);
    },
    destroy(instance) {
      instance.cleanUp();
    },
  });
  return <JOURNALS_TAG_NAME ref={ref} className={className} style={style} />;
}
