import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Register, type RegisterOptions } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { JOURNALS_TAG_NAME } from '../src/constants';
import { REGISTER_COLUMN_COUNT } from '../src/renderers/RegisterRenderer';
import { preloadRegisterHTML } from '../src/ssr/preloadRegister';
import type { RegisterRowData } from '../src/types';
import {
  dispatchScroll,
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
const HEADER_HEIGHT = 44;
const ROW_COUNT = 200;
const VIEWPORT_HEIGHT = 400;
const SCROLL_HEIGHT = HEADER_HEIGHT + ROW_COUNT * LINE_HEIGHT;

interface Harness {
  register: Register;
  section: HTMLElement;
  scroller: HTMLElement;
  rowsElement: HTMLElement;
  cleanUp(): void;
}

// Same deterministic-geometry harness as the virtualization suite: compact
// density so rowHeight === LINE_HEIGHT and the window math is exact.
async function createHarness(
  options: Partial<RegisterOptions> = {},
  rows: readonly RegisterRowData[] = makeRows(ROW_COUNT)
): Promise<Harness> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const register = new Register({
    account: 'Assets:Current:Cash-Maybank',
    density: 'compact',
    lineHeight: LINE_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    overscanRows: 10,
    virtualizer: new Virtualizer({
      overscrollSize: 0,
      intersectionObserverMargin: 0,
    }),
    ...options,
  });
  register.render({ rows, container, parentNode: document.body });
  const shadowRoot = container.shadowRoot;
  const section = shadowRoot?.querySelector('[data-register]');
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const rowsElement = shadowRoot?.querySelector('[data-register-rows]');
  if (
    !(section instanceof HTMLElement) ||
    !(scroller instanceof HTMLElement) ||
    !(rowsElement instanceof HTMLElement)
  ) {
    throw new Error('createHarness: register skeleton missing');
  }
  stubScrollerGeometry(scroller, {
    height: VIEWPORT_HEIGHT,
    scrollHeight: SCROLL_HEIGHT,
  });
  await wait(0);
  return {
    register,
    section,
    scroller,
    rowsElement,
    cleanUp() {
      register.cleanUp();
    },
  };
}

// 2 months × 100 rows: dates flip at entry index 100, so a grouped model is
// [group, 100 entries, group, 100 entries] = 202 model rows.
function makeTwoMonthRows(): RegisterRowData[] {
  return makeRows(ROW_COUNT).map((row, index) => ({
    ...row,
    entry: {
      ...row.entry,
      date: index < 100 ? '2026-01-15' : '2026-02-15',
    },
  }));
}

describe('grid-level ARIA on the register section', () => {
  test('role, default label, rowcount, tabindex; no multiselectable in single mode', async () => {
    const harness = await createHarness();
    expect(harness.section.getAttribute('role')).toBe('grid');
    expect(harness.section.getAttribute('aria-label')).toBe(
      'Assets:Current:Cash-Maybank'
    );
    expect(harness.section.getAttribute('aria-rowcount')).toBe(
      String(ROW_COUNT)
    );
    expect(harness.section.getAttribute('tabindex')).toBe('0');
    expect(harness.section.hasAttribute('aria-multiselectable')).toBe(false);
    harness.cleanUp();
  });

  test('label option overrides the account-path default', async () => {
    const harness = await createHarness({ label: 'Maybank cash register' });
    expect(harness.section.getAttribute('aria-label')).toBe(
      'Maybank cash register'
    );
    harness.cleanUp();
  });

  test('range mode gates aria-multiselectable', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    expect(harness.section.getAttribute('aria-multiselectable')).toBe('true');
    harness.cleanUp();
  });

  test('disableKeyboardNavigation drops the tab stop but keeps grid semantics', async () => {
    const harness = await createHarness({ disableKeyboardNavigation: true });
    expect(harness.section.hasAttribute('tabindex')).toBe(false);
    expect(harness.section.getAttribute('role')).toBe('grid');
    harness.cleanUp();
  });

  test('grouped registers count group headers in aria-rowcount', async () => {
    const harness = await createHarness(
      { groupBy: 'month' },
      makeTwoMonthRows()
    );
    expect(harness.section.getAttribute('aria-rowcount')).toBe(
      String(ROW_COUNT + 2)
    );
    harness.cleanUp();
  });
});

describe('row and cell ARIA under virtualization', () => {
  test('entry rows carry row role, 1-based aria-rowindex, aria-selected, and stable ids', async () => {
    const harness = await createHarness({ id: 'aria-flat' });
    const row = harness.rowsElement.querySelector('[data-row-index="5"]');
    expect(row?.getAttribute('role')).toBe('row');
    expect(row?.getAttribute('aria-rowindex')).toBe('6');
    expect(row?.getAttribute('aria-selected')).toBe('false');
    expect(row?.getAttribute('id')).toBe('aria-flat-row-5');
    const cells = row?.querySelectorAll('[role="gridcell"]');
    expect(cells?.length).toBe(REGISTER_COLUMN_COUNT);
    harness.cleanUp();
  });

  test('aria-rowindex stays correct after scrolling deep into the register', async () => {
    const harness = await createHarness();
    harness.scroller.scrollTop = 2_000;
    dispatchScroll(harness.scroller);
    await wait(0);
    // Row 100 sits at model position 101 regardless of what window it
    // renders in — virtualization must not renumber rows.
    const row = harness.rowsElement.querySelector('[data-row-index="100"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('aria-rowindex')).toBe('101');
    harness.cleanUp();
  });

  test('grouped: entry aria-rowindex counts interleaved group headers; groups are spanning rows', async () => {
    const harness = await createHarness(
      { groupBy: 'month' },
      makeTwoMonthRows()
    );
    // Model: [group(Jan), entries 0..99, group(Feb), entries 100..199].
    const first = harness.rowsElement.querySelector('[data-row-index="0"]');
    expect(first?.getAttribute('aria-rowindex')).toBe('2');
    const groupRow = harness.rowsElement.querySelector('[data-group-row]');
    expect(groupRow?.getAttribute('role')).toBe('row');
    expect(groupRow?.getAttribute('aria-rowindex')).toBe('1');
    const groupCell = groupRow?.querySelector('[data-group-cell]');
    expect(groupCell?.getAttribute('role')).toBe('gridcell');
    expect(groupCell?.getAttribute('aria-colspan')).toBe(
      String(REGISTER_COLUMN_COUNT)
    );
    // Group rows are non-interactive: no id, no tabindex.
    expect(groupRow?.hasAttribute('id')).toBe(false);
    expect(groupRow?.hasAttribute('tabindex')).toBe(false);
    harness.cleanUp();
  });

  test('grouped deep window: the Feb group header shifts entry rowindexes by 2', async () => {
    const harness = await createHarness(
      { groupBy: 'month' },
      makeTwoMonthRows()
    );
    // Entry 150's top: header 44 + 2 group headers (28px) + 150 rows (20px)
    // = 3100px; a 2900 scrollTop puts it mid-viewport.
    harness.scroller.scrollTop = 2_900;
    dispatchScroll(harness.scroller);
    await wait(0);
    // Entry 150 sits after two group headers: model index 152 → rowindex 153.
    const row = harness.rowsElement.querySelector('[data-row-index="150"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('aria-rowindex')).toBe('153');
    harness.cleanUp();
  });

  test('selection changes patch aria-selected in both directions', async () => {
    const harness = await createHarness({ selectionMode: 'range' });
    const clickRow = (index: number, init: MouseEventInit = {}) => {
      harness.rowsElement
        .querySelector(`[data-row-index="${index}"]`)
        ?.dispatchEvent(
          new MouseEvent('click', { bubbles: true, composed: true, ...init })
        );
    };
    clickRow(3);
    clickRow(5, { shiftKey: true });
    const selected = Array.from(
      harness.rowsElement.querySelectorAll('[aria-selected="true"]')
    ).map((row) => Number(row.getAttribute('data-row-index')));
    expect(selected).toEqual([3, 4, 5]);
    clickRow(4, { metaKey: true });
    expect(
      harness.rowsElement
        .querySelector('[data-row-index="4"]')
        ?.getAttribute('aria-selected')
    ).toBe('false');
    harness.cleanUp();
  });
});

describe('SSR preload carries identical ARIA', () => {
  test('flat preload: grid attributes, row roles, and option-driven ids', async () => {
    const rows = makeRows(10);
    const ssrHTML = await preloadRegisterHTML(rows, {
      account: 'Assets:Current:Cash-Maybank',
      id: 'ssr-reg',
      label: 'Cash register',
      selectionMode: 'range',
    });
    const host = document.createElement('div');
    host.innerHTML = ssrHTML;
    const section = host.querySelector('[data-register]');
    expect(section?.getAttribute('role')).toBe('grid');
    expect(section?.getAttribute('aria-label')).toBe('Cash register');
    expect(section?.getAttribute('aria-rowcount')).toBe('10');
    expect(section?.getAttribute('aria-multiselectable')).toBe('true');
    expect(section?.getAttribute('tabindex')).toBe('0');
    const row = host.querySelector('[data-row-index="4"]');
    expect(row?.getAttribute('role')).toBe('row');
    expect(row?.getAttribute('aria-rowindex')).toBe('5');
    expect(row?.getAttribute('id')).toBe('ssr-reg-row-4');
    expect(row?.querySelectorAll('[role="gridcell"]').length).toBe(
      REGISTER_COLUMN_COUNT
    );
  });

  test('grouped preload counts group headers and hydration reproduces the same ids', async () => {
    const rows = makeRows(20).map((row, index) => ({
      ...row,
      entry: {
        ...row.entry,
        date: index < 10 ? '2026-01-15' : '2026-02-15',
      },
    }));
    const ssrHTML = await preloadRegisterHTML(rows, {
      account: 'Assets:Current:Cash-Maybank',
      groupBy: 'month',
      id: 'ssr-grouped',
    });
    const container = document.createElement(JOURNALS_TAG_NAME);
    const shadowRoot = container.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = ssrHTML;
    document.body.appendChild(container);
    const section = shadowRoot.querySelector('[data-register]');
    expect(section?.getAttribute('aria-rowcount')).toBe('22');
    expect(
      shadowRoot
        .querySelector('[data-row-index="10"]')
        ?.getAttribute('aria-rowindex')
    ).toBe('13');

    // Hydration contract: the client instance gets the SAME id, so once it
    // re-windows, the rows reproduce the SSR ids byte for byte.
    const instance = new Register(
      {
        account: 'Assets:Current:Cash-Maybank',
        groupBy: 'month',
        id: 'ssr-grouped',
        virtualizer: new Virtualizer({ overscrollSize: 0 }),
      },
      true
    );
    instance.hydrate({ rows, container });
    const scroller = shadowRoot.querySelector('[data-scroller]');
    if (!(scroller instanceof HTMLElement)) {
      throw new Error('hydrated scroller missing');
    }
    // Declare geometry so the first virtualized pass windows all 22 model
    // rows (jsdom reports zero heights otherwise).
    stubScrollerGeometry(scroller, {
      height: VIEWPORT_HEIGHT,
      scrollHeight: HEADER_HEIGHT + 20 * LINE_HEIGHT + 2 * 28,
    });
    await wait(0);
    expect(
      shadowRoot.querySelector('[data-row-index="10"]')?.getAttribute('id')
    ).toBe('ssr-grouped-row-10');
    instance.cleanUp();
    container.remove();
  });

  test('preload without an id emits no row ids (nothing to agree on)', async () => {
    const ssrHTML = await preloadRegisterHTML(makeRows(3), {
      account: 'Assets:Current:Cash-Maybank',
    });
    const host = document.createElement('div');
    host.innerHTML = ssrHTML;
    expect(host.querySelector('[data-row-index="0"]')?.hasAttribute('id')).toBe(
      false
    );
  });
});
