import { expect, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __colorSchemeReady?: boolean;
    __setPageScheme?: (scheme: 'light' | 'dark') => void;
  }
}

const DARK_BG = 'rgb(10, 10, 10)';
const LIGHT_BG = 'rgb(255, 255, 255)';

async function openFixture(page: Page) {
  // The regression scenario: the OS prefers light while the page has chosen
  // its own dark theme via `html.dark` + `color-scheme: dark`.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/test/e2e/fixtures/color-scheme.html');
  await page.waitForFunction(() => window.__colorSchemeReady === true);
}

function entryBackground(page: Page, fixture: 'page-driven' | 'pinned') {
  return page.evaluate((name) => {
    const host = document.querySelector(
      `journals-container[data-fixture="${name}"]`
    );
    const entry = host?.shadowRoot?.querySelector('[data-entry]');
    return entry != null ? getComputedStyle(entry).backgroundColor : null;
  }, fixture);
}

test.describe('light-dark() color scheme resolution', () => {
  test('page-level color-scheme pin beats the light OS preference', async ({
    page,
  }) => {
    await openFixture(page);

    // html.dark + `color-scheme: dark` on the container: the entry card must
    // render its dark background even though the emulated OS prefers light —
    // this is the exact bug the color-scheme pin fixed.
    expect(await entryBackground(page, 'page-driven')).toBe(DARK_BG);
  });

  test('flipping the page class to light flips the card to light', async ({
    page,
  }) => {
    await openFixture(page);
    expect(await entryBackground(page, 'page-driven')).toBe(DARK_BG);

    await page.evaluate(() => window.__setPageScheme!('light'));
    await expect
      .poll(() => entryBackground(page, 'page-driven'))
      .toBe(LIGHT_BG);
  });

  test("colorScheme: 'dark' option pins dark regardless of page class", async ({
    page,
  }) => {
    await openFixture(page);

    expect(await entryBackground(page, 'pinned')).toBe(DARK_BG);

    // The page flips to light; the pinned card must not move.
    await page.evaluate(() => window.__setPageScheme!('light'));
    await expect
      .poll(() => entryBackground(page, 'page-driven'))
      .toBe(LIGHT_BG);
    expect(await entryBackground(page, 'pinned')).toBe(DARK_BG);
  });
});
