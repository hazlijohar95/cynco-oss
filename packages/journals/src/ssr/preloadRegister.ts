import {
  type RegisterRenderOptions,
  renderRegisterHTML,
} from '../renderers/RegisterRenderer';
import styles from '../style.css?inline';
import type { RegisterRowData } from '../types';

export interface PreloadRegisterOptions extends RegisterRenderOptions {}

// Produces the shadow-root HTML for a full register (every row — the server
// cannot know the viewport), wrapped in the same scroller/content shell the
// client Register builds so hydration can adopt the structure in place and
// simply re-window rows on the first virtualized pass.
export function preloadRegisterHTML(
  rows: readonly RegisterRowData[],
  options: PreloadRegisterOptions
): Promise<string> {
  return Promise.resolve(
    `<style>${styles}</style>` +
      '<div data-scroller><div data-journals-content>' +
      renderRegisterHTML(rows, options) +
      '</div></div>'
  );
}
