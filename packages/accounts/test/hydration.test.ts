import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { ACCOUNTS_TAG_NAME, SSR_MAX_PRELOADED_ROWS } from '../src/constants';
import { AccountTree } from '../src/render/AccountTree';
import { preloadAccountTreeHTML } from '../src/ssr/preloadAccountTree';
import {
  CHART_ACCOUNTS,
  type DomHandle,
  installDom,
  makeChartEntries,
  makeWideChart,
} from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

// Simulates what a browser does with a declarative shadow DOM template:
// attach an open shadow root and parse the preloaded HTML into it.
function createHydratedContainer(ssrHTML: string): HTMLElement {
  const container = document.createElement(ACCOUNTS_TAG_NAME);
  const shadowRoot = container.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = ssrHTML;
  document.body.appendChild(container);
  return container;
}

describe('preloadAccountTreeHTML', () => {
  test('preload HTML parses into a styled tree with every row of a small chart', async () => {
    const ssrHTML = await preloadAccountTreeHTML({
      accounts: CHART_ACCOUNTS,
      entries: makeChartEntries(),
    });
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    expect(shadowRoot?.querySelector('style')).not.toBeNull();
    expect(shadowRoot?.querySelector('[data-scroller]')).not.toBeNull();
    expect(
      shadowRoot?.querySelector('[data-scroller]')?.getAttribute('role')
    ).toBe('tree');
    expect(shadowRoot?.querySelectorAll('[data-row]').length).toBe(14);
    // Small charts fit entirely in the window: no trailing spacer height.
    const spacerAfter = shadowRoot?.querySelector('[data-spacer="after"]');
    expect((spacerAfter as HTMLElement).style.height).toBe('0px');
    container.remove();
  });

  test('large charts are capped at the 512-row deferred-projection window', async () => {
    const accounts = makeWideChart(20, 50); // 1020 rows expanded.
    const ssrHTML = await preloadAccountTreeHTML({ accounts });
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    expect(shadowRoot?.querySelectorAll('[data-row]').length).toBe(
      SSR_MAX_PRELOADED_ROWS
    );
    // Unrendered rows are represented by the after-spacer so scrollbar
    // geometry is correct before hydration (1020 - 512 rows × 30px).
    const spacerAfter = shadowRoot?.querySelector('[data-spacer="after"]');
    expect((spacerAfter as HTMLElement).style.height).toBe(
      `${(1020 - SSR_MAX_PRELOADED_ROWS) * 30}px`
    );
    container.remove();
  });

  test('respects density in markup and spacer math', async () => {
    const accounts = makeWideChart(20, 50);
    const ssrHTML = await preloadAccountTreeHTML({
      accounts,
      density: 'compact',
      initialWindowRows: 100,
    });
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    expect(
      shadowRoot?.querySelector('[data-scroller]')?.getAttribute('data-density')
    ).toBe('compact');
    const spacerAfter = shadowRoot?.querySelector('[data-spacer="after"]');
    expect((spacerAfter as HTMLElement).style.height).toBe(
      `${(1020 - 100) * 24}px`
    );
    container.remove();
  });
});

describe('AccountTree hydration', () => {
  test('hydrate adopts the SSR shadow root without a rebuild (node identity)', async () => {
    const options = {
      accounts: CHART_ACCOUNTS,
      entries: makeChartEntries(),
      id: 'hydrate-test',
    };
    const ssrHTML = await preloadAccountTreeHTML(options);
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    const ssrRows = shadowRoot?.querySelector('[data-rows]');
    const ssrFirstRow = shadowRoot?.querySelector('[data-row]');
    expect(ssrRows).not.toBeNull();

    const instance = new AccountTree(options, true);
    instance.hydrate(container);
    // Node identity preserved: hydration performed zero row DOM writes.
    expect(shadowRoot?.querySelector('[data-rows]')).toBe(ssrRows as Element);
    expect(shadowRoot?.querySelector('[data-row]')).toBe(
      ssrFirstRow as Element
    );
    // The adopted range reflects the server-rendered window.
    expect(instance.getRenderedRange()).toEqual({ start: 0, end: 14 });

    // Post-hydration interactivity works against the adopted DOM.
    instance.setExpanded('Assets', false);
    expect(shadowRoot?.querySelectorAll('[data-row]').length).toBe(9);
    instance.cleanUp();
    container.remove();
  });

  test('hydrate falls back to a fresh render when the shell is missing', () => {
    const container = document.createElement(ACCOUNTS_TAG_NAME);
    document.body.appendChild(container);
    const instance = new AccountTree({ accounts: CHART_ACCOUNTS }, true);
    instance.hydrate(container);
    expect(container.shadowRoot?.querySelectorAll('[data-row]').length).toBe(
      14
    );
    instance.cleanUp();
    container.remove();
  });
});
