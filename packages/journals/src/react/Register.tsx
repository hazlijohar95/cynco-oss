'use client';

import {
  Register as RegisterComponent,
  type RegisterOptions,
} from '../components/Register';
import { JOURNALS_TAG_NAME } from '../constants';
import type { RegisterRowData } from '../types';
import { templateRender } from './utils/templateRender';
import { useJournalsInstance } from './utils/useJournalsInstance';

export interface RegisterProps {
  rows: readonly RegisterRowData[];
  options: RegisterOptions;
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
  className,
  style,
  ssrHTML,
}: RegisterProps): React.JSX.Element {
  const { ref } = useJournalsInstance<RegisterComponent>({
    create(container) {
      const instance = new RegisterComponent(options, true);
      instance.hydrate({ rows, container });
      return instance;
    },
    update(instance) {
      instance.setOptions(options);
      instance.setRows(rows);
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
