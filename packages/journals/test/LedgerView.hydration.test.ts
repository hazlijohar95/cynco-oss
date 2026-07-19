import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { type LedgerSection, LedgerView } from '../src/components/LedgerView';
import {
  JOURNALS_TAG_NAME,
  SSR_MAX_PRELOADED_ROWS_PER_SECTION,
  SSR_MAX_PRELOADED_TOTAL_ROWS,
} from '../src/constants';
import { preloadLedgerViewHTML } from '../src/ssr/preloadLedgerView';
import {
  type DomHandle,
  installDom,
  makeRows,
  stubScrollerGeometry,
  wait,
} from './domHarness';

let dom: DomHandle;

beforeAll(() => {
  dom = installDom();
});

afterAll(() => {
  dom.cleanup();
});

const LINE_HEIGHT = 20;

// Simulates what a browser does with a declarative shadow DOM template:
// attach an open shadow root and parse the preloaded HTML into it.
function createHydratedContainer(ssrHTML: string): HTMLElement {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const shadowRoot = container.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = ssrHTML;
  document.body.appendChild(container);
  return container;
}

function makeSections(counts: readonly number[]): LedgerSection[] {
  return counts.map((count, index) => ({
    account: `Assets:Section-${index}`,
    rows: makeRows(count),
  }));
}

function rowCounts(shadowRoot: ShadowRoot | null): number[] {
  return Array.from(shadowRoot?.querySelectorAll('[data-register]') ?? []).map(
    (section) => section.querySelectorAll('[data-row]').length
  );
}

describe('preloadLedgerViewHTML', () => {
  test('renders shell, per-section sticky headers, and sized spacers', async () => {
    const sections = makeSections([300, 10]);
    const ssrHTML = await preloadLedgerViewHTML(sections, {
      density: 'compact',
      lineHeight: LINE_HEIGHT,
    });
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    expect(shadowRoot?.querySelector('style')).not.toBeNull();
    expect(
      shadowRoot?.querySelector('[data-scroller][data-ledger-view]')
    ).not.toBeNull();
    const registers = shadowRoot?.querySelectorAll('[data-register]');
    expect(registers?.length).toBe(2);
    expect(shadowRoot?.querySelectorAll('[data-register-header]').length).toBe(
      2
    );
    // Section 0 capped at the per-section max; the truncated rows are
    // represented by an exactly sized after-spacer so pre-hydration
    // scrollbar geometry matches the client's.
    expect(rowCounts(shadowRoot)).toEqual([
      SSR_MAX_PRELOADED_ROWS_PER_SECTION,
      10,
    ]);
    const spacerAfter = registers?.[0].querySelector(
      '[data-register-spacer="after"]'
    ) as HTMLElement;
    expect(spacerAfter.style.height).toBe(
      `${(300 - SSR_MAX_PRELOADED_ROWS_PER_SECTION) * LINE_HEIGHT}px`
    );
    // aria-rowcount reports the FULL count: the cap limits DOM, not grid
    // semantics (exactly like client-side virtualization).
    expect(registers?.[0].getAttribute('aria-rowcount')).toBe('300');
    container.remove();
  });

  test('respects the TOTAL cap across sections, leading sections first', async () => {
    const counts = Array.from({ length: 8 }, () => 128);
    const ssrHTML = await preloadLedgerViewHTML(makeSections(counts), {
      density: 'compact',
      lineHeight: LINE_HEIGHT,
    });
    const container = createHydratedContainer(ssrHTML);
    // Budget 512 = 4 full sections of 128; the rest emit headers + spacers
    // only.
    expect(rowCounts(container.shadowRoot)).toEqual([
      128, 128, 128, 128, 0, 0, 0, 0,
    ]);
    const total = rowCounts(container.shadowRoot).reduce((a, b) => a + b, 0);
    expect(total).toBe(SSR_MAX_PRELOADED_TOTAL_ROWS);
    container.remove();
  });

  test('custom caps override the defaults', async () => {
    const ssrHTML = await preloadLedgerViewHTML(makeSections([20, 20, 20]), {
      density: 'compact',
      lineHeight: LINE_HEIGHT,
      maxRowsPerSection: 10,
      maxTotalRows: 15,
    });
    const container = createHydratedContainer(ssrHTML);
    expect(rowCounts(container.shadowRoot)).toEqual([10, 5, 0]);
    container.remove();
  });
});

describe('LedgerView hydration', () => {
  test('hydrate adopts the SSR shadow root with zero DOM rebuilds', async () => {
    const sections = makeSections([20, 15, 10]);
    const ssrHTML = await preloadLedgerViewHTML(sections, {
      id: 'ssrledger',
      density: 'compact',
      lineHeight: LINE_HEIGHT,
    });
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    const content = shadowRoot?.querySelector('[data-journals-content]');
    const ssrSections = Array.from(
      shadowRoot?.querySelectorAll('[data-register]') ?? []
    );
    const htmlBeforeHydration = content?.innerHTML;
    expect(ssrSections.length).toBe(3);

    const view = new LedgerView(
      {
        id: 'ssrledger',
        density: 'compact',
        lineHeight: LINE_HEIGHT,
      },
      true
    );
    view.hydrate({ sections, container });
    // Zero rebuild at adoption time: byte-identical markup AND preserved
    // node identity for every section (the Register hydration idiom).
    expect(content?.innerHTML).toBe(htmlBeforeHydration as string);
    const adopted = Array.from(
      shadowRoot?.querySelectorAll('[data-register]') ?? []
    );
    for (const [index, section] of adopted.entries()) {
      expect(section).toBe(ssrSections[index]);
    }
    expect(view.getRegisters().length).toBe(3);
    view.cleanUp();
    container.remove();
  });

  test('per-section ARIA ids agree between preload and hydrated client', async () => {
    const sections = makeSections([20, 15]);
    const ssrHTML = await preloadLedgerViewHTML(sections, {
      id: 'ssrledger',
      density: 'compact',
      lineHeight: LINE_HEIGHT,
    });
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    // The preload baked `{viewId}-s{index}` prefixes into row ids.
    expect(shadowRoot?.querySelector('#ssrledger-s0-row-3')).not.toBeNull();
    expect(shadowRoot?.querySelector('#ssrledger-s1-row-0')).not.toBeNull();

    // Declare real scroll geometry so the first virtualized pass keeps the
    // preloaded rows materialized instead of windowing to a 0-height view.
    const scroller = shadowRoot?.querySelector('[data-scroller]');
    if (scroller instanceof HTMLElement) {
      stubScrollerGeometry(scroller, {
        height: 400,
        scrollHeight: 2 * 44 + 35 * LINE_HEIGHT,
      });
    }

    const view = new LedgerView(
      { id: 'ssrledger', density: 'compact', lineHeight: LINE_HEIGHT },
      true
    );
    view.hydrate({ sections, container });
    // The hydrated register points aria-activedescendant at the SSR-emitted
    // id — the id contract holds across the seam.
    view.getRegisters()[1].focusRow(3);
    await wait(0);
    const section = shadowRoot?.querySelectorAll('[data-register]')[1];
    expect(section?.getAttribute('aria-activedescendant')).toBe(
      'ssrledger-s1-row-3'
    );
    view.cleanUp();
    container.remove();
  });

  test('hydrate falls back to render when SSR markup is missing', async () => {
    const container = document.createElement(JOURNALS_TAG_NAME);
    container.attachShadow({ mode: 'open' });
    document.body.appendChild(container);
    const view = new LedgerView({ density: 'compact' }, true);
    view.hydrate({ sections: makeSections([5, 5]), container });
    await wait(0);
    expect(
      container.shadowRoot?.querySelectorAll('[data-register]').length
    ).toBe(2);
    expect(view.getRegisters().length).toBe(2);
    view.cleanUp();
    container.remove();
  });
});
