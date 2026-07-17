'use client';

import { ACCOUNTS_TAG_NAME } from '../constants';
import type { AccountTreeOptions } from '../render/AccountTree';
import { useAccountTree } from './useAccountTree';
import { templateRender } from './utils/templateRender';

export interface AccountTreeProps {
  options: AccountTreeOptions;
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
  className,
  style,
  ssrHTML,
}: AccountTreeProps): React.JSX.Element {
  const { ref } = useAccountTree(options);
  return (
    <ACCOUNTS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(null, ssrHTML)}
    </ACCOUNTS_TAG_NAME>
  );
}
