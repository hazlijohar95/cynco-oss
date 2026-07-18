'use client';

import {
  EntryStream as EntryStreamComponent,
  type EntryStreamOptions,
} from '../components/EntryStream';
import { JOURNALS_TAG_NAME } from '../constants';
import type { ColorScheme } from '../types';
import { mergeColorSchemeStyle } from './utils/mergeColorSchemeStyle';
import { useJournalsInstance } from './utils/useJournalsInstance';

export interface EntryStreamProps {
  /**
   * Component options including the stream source. The stream is consumed
   * once, by the instance created on mount — remount (e.g. via `key`) to
   * attach a new source; other option changes apply in place.
   */
  options: EntryStreamOptions;
  /** Shorthand for `options.colorScheme`, painted on the host element too. */
  colorScheme?: ColorScheme;
  className?: string;
  style?: React.CSSProperties;
}

export function EntryStream({
  options,
  colorScheme,
  className,
  style,
}: EntryStreamProps): React.JSX.Element {
  const mergedOptions: EntryStreamOptions =
    colorScheme != null ? { ...options, colorScheme } : options;
  const { ref } = useJournalsInstance<EntryStreamComponent>({
    create(container) {
      const instance = new EntryStreamComponent(mergedOptions, true);
      instance.render({ container });
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
    />
  );
}
