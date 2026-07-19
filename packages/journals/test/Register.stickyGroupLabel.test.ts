import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { Register, type RegisterOptions } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { JOURNALS_TAG_NAME } from '../src/constants';
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

// Compact geometry: entry rows 20px, group headers 28px, register header 44.
// 100 January rows + 100 February rows put the model offsets at:
// group Jan 0, entries 28..2008, group Feb 2028, entries 2056..
const LINE_HEIGHT = 20;
const HEADER_HEIGHT = 44;
const VIEWPORT_HEIGHT = 400;
const SCROLL_HEIGHT = HEADER_HEIGHT + 2 * 28 + 200 * LINE_HEIGHT;

interface Harness {
  register: Register;
  scroller: HTMLElement;
  section: HTMLElement;
  cleanUp(): void;
}

async function createHarness(
  options: Partial<RegisterOptions> = {}
): Promise<Harness> {
  const container = document.createElement(JOURNALS_TAG_NAME);
  const rows = makeRows(200).map((row, index) => ({
    ...row,
    entry: {
      ...row.entry,
      date: index < 100 ? '2026-01-15' : '2026-02-15',
    },
  }));
  const register = new Register({
    account: 'Assets:Current:Cash-Maybank',
    density: 'compact',
    lineHeight: LINE_HEIGHT,
    headerHeight: HEADER_HEIGHT,
    overscanRows: 10,
    groupBy: 'month',
    virtualizer: new Virtualizer({
      overscrollSize: 0,
      intersectionObserverMargin: 0,
    }),
    ...options,
  });
  register.render({ rows, container, parentNode: document.body });
  const shadowRoot = container.shadowRoot;
  const scroller = shadowRoot?.querySelector('[data-scroller]');
  const section = shadowRoot?.querySelector('[data-register]');
  if (!(scroller instanceof HTMLElement) || !(section instanceof HTMLElement)) {
    throw new Error('createHarness: register skeleton missing');
  }
  stubScrollerGeometry(scroller, {
    height: VIEWPORT_HEIGHT,
    scrollHeight: SCROLL_HEIGHT,
  });
  await wait(0);
  return {
    register,
    scroller,
    section,
    cleanUp() {
      register.cleanUp();
    },
  };
}

function stickyElement(harness: Harness): HTMLElement | null {
  const element = harness.section.querySelector('[data-group-sticky]');
  return element instanceof HTMLElement ? element : null;
}

function stickyLabelText(harness: Harness): string | null {
  return (
    stickyElement(harness)?.querySelector('[data-group-label]')?.textContent ??
    null
  );
}

async function scrollTo(harness: Harness, scrollTop: number): Promise<void> {
  harness.scroller.scrollTop = scrollTop;
  dispatchScroll(harness.scroller);
  await wait(0);
}

describe('sticky group labels (grouped register)', () => {
  test('hidden at the top of scroll, aria-hidden, pinned below the header', async () => {
    const harness = await createHarness();
    const element = stickyElement(harness);
    expect(element).not.toBeNull();
    expect(element?.hidden).toBe(true);
    // The mirror is presentation only: the real group rows own semantics.
    expect(element?.getAttribute('aria-hidden')).toBe('true');
    expect(element?.style.top).toBe(`${HEADER_HEIGHT}px`);
    harness.cleanUp();
  });

  test('reflects the period of the top visible row across scroll positions', async () => {
    const harness = await createHarness();

    // Mid-January: the Jan header scrolled under the seam.
    await scrollTo(harness, 500);
    expect(stickyElement(harness)?.hidden).toBe(false);
    expect(stickyLabelText(harness)).toBe('January 2026');

    // Deep into February.
    await scrollTo(harness, 3000);
    expect(stickyLabelText(harness)).toBe('February 2026');

    // Back up into January again.
    await scrollTo(harness, 1000);
    expect(stickyLabelText(harness)).toBe('January 2026');

    // Back to the very top: the first group header is fully visible, so the
    // mirror hides instead of doubling it.
    await scrollTo(harness, 0);
    expect(stickyElement(harness)?.hidden).toBe(true);
    harness.cleanUp();
  });

  test('the mirror stays hidden while a group header row sits exactly at the seam', async () => {
    const harness = await createHarness();
    // February's header spans model offsets [2028, 2056). With its top
    // exactly at the seam it is fully visible → no mirror; one pixel later
    // it is partially covered → mirror shows February.
    await scrollTo(harness, 2028);
    expect(stickyElement(harness)?.hidden).toBe(true);
    await scrollTo(harness, 2029);
    expect(stickyElement(harness)?.hidden).toBe(false);
    expect(stickyLabelText(harness)).toBe('February 2026');
    harness.cleanUp();
  });

  test('mirror content reuses the group-row vocabulary with the period meta', async () => {
    const harness = await createHarness();
    await scrollTo(harness, 500);
    const mirror = stickyElement(harness)?.querySelector('[data-group-row]');
    expect(mirror).not.toBeNull();
    expect(mirror?.hasAttribute('data-sticky-mirror')).toBe(true);
    // No grid semantics on the mirror: the real group row carries them.
    expect(mirror?.getAttribute('role')).toBeNull();
    expect(mirror?.querySelector('[data-group-count]')?.textContent).toBe(
      '100 entries'
    );
    harness.cleanUp();
  });

  test("no sticky element when groupBy is 'none'", async () => {
    const harness = await createHarness({ groupBy: 'none' });
    expect(stickyElement(harness)).toBeNull();
    harness.cleanUp();
  });

  test('stickyGroupLabels: false opts out under grouping', async () => {
    const harness = await createHarness({ stickyGroupLabels: false });
    expect(stickyElement(harness)).toBeNull();
    await scrollTo(harness, 500);
    expect(stickyElement(harness)).toBeNull();
    harness.cleanUp();
  });
});
