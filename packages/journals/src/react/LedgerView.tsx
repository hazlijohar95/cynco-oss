'use client';

import {
  type LedgerSection,
  LedgerView as LedgerViewComponent,
  type LedgerViewOptions,
} from '../components/LedgerView';
import { JOURNALS_TAG_NAME } from '../constants';
import type { ColorScheme } from '../types';
import { mergeColorSchemeStyle } from './utils/mergeColorSchemeStyle';
import { templateRender } from './utils/templateRender';
import { useJournalsInstance } from './utils/useJournalsInstance';

export interface LedgerViewProps {
  sections: readonly LedgerSection[];
  options?: LedgerViewOptions;
  /**
   * Shorthand for `options.colorScheme` (see that field for the
   * light-dark()/user-preference pitfall). Also painted as an inline
   * `color-scheme` style on the custom element so server markup resolves to
   * the requested mode before hydration runs.
   */
  colorScheme?: ColorScheme;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Shadow-root HTML from `preloadLedgerViewHTML`. Rendered as a
   * declarative shadow DOM template on the server; on the client the
   * vanilla class adopts the parsed shadow root — every section Register
   * adopts its preloaded markup in place — and re-windows rows on the first
   * virtualized pass. Pass the same `options.id` used for the preload so
   * per-section ARIA row ids agree.
   */
  ssrHTML?: string;
}

export function LedgerView({
  sections,
  options,
  colorScheme,
  className,
  style,
  ssrHTML,
}: LedgerViewProps): React.JSX.Element {
  const mergedOptions: LedgerViewOptions | undefined =
    colorScheme != null ? { ...options, colorScheme } : options;
  const { ref } = useJournalsInstance<LedgerViewComponent>({
    create(container) {
      const instance = new LedgerViewComponent(mergedOptions ?? {}, true);
      // hydrate falls back to render when no SSR shadow root is present,
      // so one code path serves both preloaded and client-only mounts.
      instance.hydrate({ sections, container });
      return instance;
    },
    update(instance) {
      instance.setOptions(mergedOptions);
      instance.setSections(sections);
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
