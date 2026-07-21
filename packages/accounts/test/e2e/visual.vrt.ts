import { expect, type Locator, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __vrtReady?: boolean;
    __applySelection?: () => void;
    __stickyScroller?: HTMLElement;
    __stickyRowHeight?: number;
    __stickyRowIndex?: (path: string) => number;
    __stickyReadout?: () => { hidden: boolean; name: string | null };
    __startLoading?: () => void;
    __startError?: () => void;
  }
}

// Every subject is captured under BOTH schemes: light-dark() theming is a
// core feature, so a light-only lane would leave half the palette (and every
// scheme-conditional treatment) unprotected.
const SCHEMES = ['light', 'dark'] as const;
type Scheme = (typeof SCHEMES)[number];

// Determinism contract, applied before every capture (viewport, DSF, and
// reduced motion are pinned in playwright.vrt.config.ts):
// - colorScheme pinned per shot, never inherited from the OS;
// - reducedMotion re-asserted so component transitions are neutralized by
//   the package's own prefers-reduced-motion rules, not just frozen by the
//   screenshot call;
// - fonts.ready + a double rAF so late glyph swaps or a pending render
//   commit can never race the capture.
async function openFixture(page: Page, scheme: Scheme): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await page.goto('/test/e2e/fixtures/vrt.html');
  await page.waitForFunction(() => window.__vrtReady === true);
  await settle(page);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  });
}

function subject(page: Page, slotId: string): Locator {
  return page.locator(`#${slotId} accounts-container`);
}

for (const scheme of SCHEMES) {
  test.describe(`accounts visual baselines (${scheme})`, () => {
    test(`tree default density (${scheme})`, async ({ page }) => {
      await openFixture(page, scheme);
      await expect(subject(page, 'tree-default')).toHaveScreenshot(
        `tree-default-${scheme}.png`
      );
    });

    test(`tree compact density (${scheme})`, async ({ page }) => {
      await openFixture(page, scheme);
      await expect(subject(page, 'tree-compact')).toHaveScreenshot(
        `tree-compact-${scheme}.png`
      );
    });

    test(`tree relaxed density (${scheme})`, async ({ page }) => {
      await openFixture(page, scheme);
      await expect(subject(page, 'tree-relaxed')).toHaveScreenshot(
        `tree-relaxed-${scheme}.png`
      );
    });

    test(`tree selected + focused ring treatments (${scheme})`, async ({
      page,
    }) => {
      await openFixture(page, scheme);
      await page.evaluate(() => window.__applySelection!());
      const tree = subject(page, 'tree-selection');
      // Both treatments must be committed before the shot: the selected-only
      // surface and the selected+focused mixed ring.
      await expect(
        tree.locator('[data-row][data-selected="true"]')
      ).toHaveCount(2);
      await expect(tree.locator('[data-row][data-focused="true"]')).toHaveCount(
        1
      );
      await settle(page);
      await expect(tree).toHaveScreenshot(
        `tree-selected-focused-${scheme}.png`
      );
    });

    test(`tree sticky ancestor header engaged mid-scroll (${scheme})`, async ({
      page,
    }) => {
      await openFixture(page, scheme);
      // Land mid-way through Group1:Mid02 so its children fill the viewport
      // while the group row itself is evicted above the window — the exact
      // condition the sticky ancestor mirror exists for. The name assertion
      // makes a silent scroll-geometry change fail loudly instead of
      // producing a different-looking baseline.
      await page.evaluate(() => {
        const index = window.__stickyRowIndex!('Group1:Mid02:Leaf03');
        window.__stickyScroller!.scrollTop = index * window.__stickyRowHeight!;
      });
      await page.waitForFunction(() => {
        const readout = window.__stickyReadout!();
        return readout.hidden === false && readout.name === 'Mid02';
      });
      await settle(page);
      await expect(subject(page, 'tree-sticky')).toHaveScreenshot(
        `tree-sticky-ancestor-${scheme}.png`
      );
    });

    test(`tree child-load loading placeholder row (${scheme})`, async ({
      page,
    }) => {
      await openFixture(page, scheme);
      // The fixture's loader never settles, so once the placeholder row is
      // up the state can never change under the capture.
      await page.evaluate(() => window.__startLoading!());
      await expect(
        subject(page, 'tree-loading').locator(
          '[data-load-placeholder="loading"]'
        )
      ).toBeVisible();
      await settle(page);
      await expect(subject(page, 'tree-loading')).toHaveScreenshot(
        `tree-loading-placeholder-${scheme}.png`
      );
    });

    test(`tree child-load error + retry row (${scheme})`, async ({ page }) => {
      await openFixture(page, scheme);
      await page.evaluate(() => window.__startError!());
      const errorRow = subject(page, 'tree-error').locator(
        '[data-load-placeholder="error"]'
      );
      await expect(errorRow).toBeVisible();
      await expect(errorRow.locator('[data-load-retry]')).toBeVisible();
      await settle(page);
      await expect(subject(page, 'tree-error')).toHaveScreenshot(
        `tree-error-retry-${scheme}.png`
      );
    });
  });
}
