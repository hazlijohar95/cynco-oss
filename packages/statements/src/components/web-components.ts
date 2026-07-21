import { STATEMENTS_TAG_NAME } from '../constants';
import styles from '../style.css?inline';

// If HTMLElement is undefined it usually means we are in a server environment
// so best to just not do anything
if (
  typeof HTMLElement !== 'undefined' &&
  customElements.get(STATEMENTS_TAG_NAME) == null
) {
  let sheet: CSSStyleSheet | undefined;

  class StatementsContainer extends HTMLElement {
    constructor() {
      super();
      // If shadow root is already open (declarative shadow DOM from SSR), we
      // can sorta assume the CSS is already in place
      if (this.shadowRoot != null) {
        return;
      }
      const shadowRoot = this.attachShadow({ mode: 'open' });
      if (sheet == null) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(styles);
      }
      shadowRoot.adoptedStyleSheets = [sheet];
    }
  }

  customElements.define(STATEMENTS_TAG_NAME, StatementsContainer);
}

export const StatementsContainerLoaded = true;
