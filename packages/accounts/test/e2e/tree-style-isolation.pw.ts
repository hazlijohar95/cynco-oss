import { expect, type Page, test } from '@playwright/test';

import './helpers/fixtureWindow';

async function openFixture(page: Page) {
  await page.goto('/test/e2e/fixtures/tree-style-isolation.html');
  await page.waitForFunction(() => window.__treeStyleIsolationReady === true);
}

test.describe('account tree shadow style isolation', () => {
  test('hostile page CSS does not leak into shadow tree rows', async ({
    page,
  }) => {
    await openFixture(page);

    const rowStyles = await page.evaluate(() => {
      const host = document.getElementById('test-tree-host');
      const row = host?.shadowRoot?.querySelector('[data-rows] [data-row]');
      if (row == null) {
        return null;
      }
      const computed = getComputedStyle(row);
      return {
        backgroundColor: computed.backgroundColor,
        fontSize: computed.fontSize,
        display: computed.display,
      };
    });

    expect(rowStyles).not.toBeNull();
    // Rows carry no background at rest; the page's lime/red !important rules
    // must not reach them, nor may the 40px page font or the display
    // override cross the shadow boundary.
    expect(rowStyles?.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(rowStyles?.fontSize).toBe('13px');
    expect(rowStyles?.display).toBe('flex');
  });

  test('external id selector does not style shadow-root node with same id', async ({
    page,
  }) => {
    await openFixture(page);

    const colors = await page.evaluate(() => {
      const outside = document.querySelector(
        '[data-test-outside-duplicate-id]'
      );
      const host = document.getElementById('test-tree-host');
      const inside = host?.shadowRoot?.querySelector(
        '[data-test-shadow-dup-id]'
      );
      return {
        outside: outside != null ? getComputedStyle(outside).color : null,
        inside: inside != null ? getComputedStyle(inside).color : null,
      };
    });

    expect(colors.outside).toBe('rgb(0, 128, 0)');
    expect(colors.inside).not.toBe('rgb(0, 128, 0)');
  });

  test('tree internal styles do not leak out to light DOM pseudo rows', async ({
    page,
  }) => {
    await openFixture(page);

    const styles = await page.evaluate(() => {
      const outside = document.querySelector('[data-test-outside-pseudo-row]');
      if (outside == null) {
        return null;
      }
      const computed = getComputedStyle(outside);
      return {
        backgroundColor: computed.backgroundColor,
        display: computed.display,
      };
    });

    // The light-DOM element wearing the component's row attributes only ever
    // sees the page's own hostile rules — never the component's selected-row
    // background or flex row layout.
    expect(styles).not.toBeNull();
    expect(styles?.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(styles?.display).not.toBe('flex');
  });

  test('css custom properties flow into the shadow root for theming', async ({
    page,
  }) => {
    await openFixture(page);

    const hostBackground = await page.evaluate(() => {
      const host = document.getElementById('test-tree-host');
      return host != null ? getComputedStyle(host).backgroundColor : null;
    });

    expect(hostBackground).toBe('rgb(1, 2, 3)');
  });
});
