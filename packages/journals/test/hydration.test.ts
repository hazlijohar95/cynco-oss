import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { EntryDiff } from '../src/components/EntryDiff';
import { JournalEntry } from '../src/components/JournalEntry';
import { Register } from '../src/components/Register';
import { Virtualizer } from '../src/components/Virtualizer';
import { JOURNALS_TAG_NAME } from '../src/constants';
import { preloadEntryDiffHTML } from '../src/ssr/preloadEntryDiff';
import { preloadJournalEntryHTML } from '../src/ssr/preloadJournalEntry';
import { preloadRegisterHTML } from '../src/ssr/preloadRegister';
import { type DomHandle, installDom, makeEntry, makeRows } from './domHarness';

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
  const container = document.createElement(JOURNALS_TAG_NAME);
  const shadowRoot = container.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = ssrHTML;
  document.body.appendChild(container);
  return container;
}

describe('JournalEntry hydration', () => {
  test('preload HTML parses into a styled entry card', async () => {
    const ssrHTML = await preloadJournalEntryHTML(makeEntry());
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    expect(shadowRoot?.querySelector('style')).not.toBeNull();
    expect(shadowRoot?.querySelector('[data-entry]')).not.toBeNull();
    expect(shadowRoot?.querySelectorAll('[data-posting]').length).toBe(2);
    container.remove();
  });

  test('hydrate adopts the SSR shadow root without re-rendering', async () => {
    const entry = makeEntry();
    const ssrHTML = await preloadJournalEntryHTML(entry, {
      showLineNumbers: false,
    });
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    const ssrCard = shadowRoot?.querySelector('[data-entry]');
    expect(ssrCard).not.toBeNull();

    const instance = new JournalEntry({}, true);
    instance.hydrate({ entry, container });
    // Node identity preserved: hydration performed zero DOM writes.
    expect(shadowRoot?.querySelector('[data-entry]')).toBe(ssrCard as Element);

    // A follow-up render with structurally-equal data (fresh object, same
    // values) must also be a no-op.
    instance.render({ entry: makeEntry() });
    expect(shadowRoot?.querySelector('[data-entry]')).toBe(ssrCard as Element);
    instance.cleanUp();
    container.remove();
  });

  test('render with changed data replaces the adopted card in place', async () => {
    const entry = makeEntry();
    const ssrHTML = await preloadJournalEntryHTML(entry);
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    const ssrCard = shadowRoot?.querySelector('[data-entry]');

    const instance = new JournalEntry({}, true);
    instance.hydrate({ entry, container });
    instance.render({ entry: makeEntry({ narration: 'Amended narration' }) });

    const nextCard = shadowRoot?.querySelector('[data-entry]');
    expect(nextCard).not.toBe(ssrCard as Element);
    expect(nextCard?.querySelector('[data-narration]')?.textContent).toBe(
      'Amended narration'
    );
    // The SSR <style> sibling survives the swap.
    expect(shadowRoot?.querySelector('style')).not.toBeNull();
    instance.cleanUp();
    container.remove();
  });
});

describe('Register hydration', () => {
  test('preload HTML parses and hydrate adopts the section skeleton', async () => {
    const rows = makeRows(20);
    const ssrHTML = await preloadRegisterHTML(rows, {
      account: 'Assets:Current:Cash-Maybank',
    });
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    const ssrSection = shadowRoot?.querySelector('[data-register]');
    const ssrHeader = shadowRoot?.querySelector('[data-register-header]');
    expect(ssrSection).not.toBeNull();
    expect(shadowRoot?.querySelectorAll('[data-row]').length).toBe(20);

    const instance = new Register(
      {
        account: 'Assets:Current:Cash-Maybank',
        virtualizer: new Virtualizer({ overscrollSize: 0 }),
      },
      true
    );
    instance.hydrate({ rows, container });
    // The section and header skeleton are adopted, not rebuilt.
    expect(shadowRoot?.querySelector('[data-register]')).toBe(
      ssrSection as Element
    );
    expect(shadowRoot?.querySelector('[data-register-header]')).toBe(
      ssrHeader as Element
    );
    instance.cleanUp();
    container.remove();
  });

  test('grouped preload renders group headers and hydrate adopts them in place', async () => {
    // Two months so the SSR output carries two interleaved group headers.
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
    });
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    const ssrSection = shadowRoot?.querySelector('[data-register]');
    const groupRows = Array.from(
      shadowRoot?.querySelectorAll('[data-group-row]') ?? []
    );
    expect(groupRows.map((row) => row.getAttribute('data-group-key'))).toEqual([
      '2026-01',
      '2026-02',
    ]);
    expect(shadowRoot?.querySelectorAll('[data-row]').length).toBe(20);
    // Entry indexes stay in entry space under grouping.
    expect(shadowRoot?.querySelector('[data-row-index="10"]')).not.toBeNull();

    const instance = new Register(
      {
        account: 'Assets:Current:Cash-Maybank',
        groupBy: 'month',
        virtualizer: new Virtualizer({ overscrollSize: 0 }),
      },
      true
    );
    instance.hydrate({ rows, container });
    expect(shadowRoot?.querySelector('[data-register]')).toBe(
      ssrSection as Element
    );
    instance.cleanUp();
    container.remove();
  });
});

describe('EntryDiff hydration', () => {
  test('preload HTML parses into a styled diff card', async () => {
    const before = makeEntry();
    const after = makeEntry({ narration: 'Amended narration' });
    const ssrHTML = await preloadEntryDiffHTML(before, after);
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    expect(shadowRoot?.querySelector('style')).not.toBeNull();
    expect(shadowRoot?.querySelector('[data-entry-diff]')).not.toBeNull();
    expect(
      shadowRoot
        ?.querySelector('[data-diff-field="narration"]')
        ?.getAttribute('data-field-kind')
    ).toBe('changed');
    container.remove();
  });

  test('hydrate adopts the SSR shadow root without re-rendering', async () => {
    const before = makeEntry();
    const after = makeEntry({ narration: 'Amended narration' });
    const ssrHTML = await preloadEntryDiffHTML(before, after);
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    const ssrCard = shadowRoot?.querySelector('[data-entry-diff]');
    expect(ssrCard).not.toBeNull();

    const instance = new EntryDiff({}, true);
    instance.hydrate({ before, after, container });
    // Node identity preserved: hydration performed zero DOM writes.
    expect(shadowRoot?.querySelector('[data-entry-diff]')).toBe(
      ssrCard as Element
    );

    // A follow-up render with structurally-equal inputs (fresh objects,
    // same values) must also be a no-op.
    instance.render({
      before: makeEntry(),
      after: makeEntry({ narration: 'Amended narration' }),
    });
    expect(shadowRoot?.querySelector('[data-entry-diff]')).toBe(
      ssrCard as Element
    );
    instance.cleanUp();
    container.remove();
  });

  test('render with changed inputs replaces the adopted card in place', async () => {
    const before = makeEntry();
    const after = makeEntry({ narration: 'Amended narration' });
    const ssrHTML = await preloadEntryDiffHTML(before, after);
    const container = createHydratedContainer(ssrHTML);
    const shadowRoot = container.shadowRoot;
    const ssrCard = shadowRoot?.querySelector('[data-entry-diff]');

    const instance = new EntryDiff({}, true);
    instance.hydrate({ before, after, container });
    instance.render({ before, after: null });

    const nextCard = shadowRoot?.querySelector('[data-entry-diff]');
    expect(nextCard).not.toBe(ssrCard as Element);
    expect(nextCard?.getAttribute('data-diff-kind')).toBe('deleted');
    // The SSR <style> sibling survives the swap.
    expect(shadowRoot?.querySelector('style')).not.toBeNull();
    instance.cleanUp();
    container.remove();
  });
});
