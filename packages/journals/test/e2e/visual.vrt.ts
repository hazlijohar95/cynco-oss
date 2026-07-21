import { expect, type Locator, type Page, test } from '@playwright/test';

interface StickyReadout {
  hidden: boolean | null;
  label: string | null;
}

declare global {
  interface Window {
    __vrtReady?: boolean;
    __groupedRegister?: {
      scrollToDate(isoDate: string, options?: { align?: string }): void;
    };
    __stickyReadout?: () => StickyReadout;
    // Accepts the first match, rejects the second, returns the accepted
    // match id. Named apart from the e2e spec's __recon declaration so the
    // shared global Window type merges cleanly.
    __applyVerdicts?: () => string;
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
//   the packages' own prefers-reduced-motion rules, not just frozen by the
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
  return page.locator(`#${slotId} journals-container`);
}

for (const scheme of SCHEMES) {
  test.describe(`journals visual baselines (${scheme})`, () => {
    test(`register comfortable density (${scheme})`, async ({ page }) => {
      await openFixture(page, scheme);
      await expect(subject(page, 'register-comfortable')).toHaveScreenshot(
        `register-comfortable-${scheme}.png`
      );
    });

    test(`register compact density (${scheme})`, async ({ page }) => {
      await openFixture(page, scheme);
      await expect(subject(page, 'register-compact')).toHaveScreenshot(
        `register-compact-${scheme}.png`
      );
    });

    test(`register empty state (${scheme})`, async ({ page }) => {
      await openFixture(page, scheme);
      await expect(subject(page, 'register-empty')).toHaveScreenshot(
        `register-empty-${scheme}.png`
      );
    });

    test(`grouped register with sticky period label engaged (${scheme})`, async ({
      page,
    }) => {
      await openFixture(page, scheme);
      // Jump mid-March via the public scroll API (instant by default), then
      // require the sticky mirror to show the expected period before the
      // shot — a silent scroll-geometry change must fail the assertion, not
      // quietly produce a different-looking baseline.
      await page.evaluate(() => {
        window.__groupedRegister!.scrollToDate('2026-03-15', {
          align: 'start',
        });
      });
      await page.waitForFunction(() => {
        const readout = window.__stickyReadout!();
        return readout.hidden === false && readout.label === 'March 2026';
      });
      await settle(page);
      await expect(subject(page, 'register-grouped')).toHaveScreenshot(
        `register-grouped-sticky-${scheme}.png`
      );
    });

    test(`journal entry card balanced (${scheme})`, async ({ page }) => {
      await openFixture(page, scheme);
      await expect(subject(page, 'entry-balanced')).toHaveScreenshot(
        `entry-card-balanced-${scheme}.png`
      );
    });

    test(`journal entry card flagged + unbalanced (${scheme})`, async ({
      page,
    }) => {
      await openFixture(page, scheme);
      // The imbalance treatment only renders for non-zero residuals; assert
      // it exists so a data typo cannot silently downgrade this shot to a
      // second balanced card.
      await expect(
        subject(page, 'entry-unbalanced').locator('[data-imbalance]')
      ).toBeVisible();
      await expect(subject(page, 'entry-unbalanced')).toHaveScreenshot(
        `entry-card-unbalanced-${scheme}.png`
      );
    });

    test(`reconciliation session with proposed matches (${scheme})`, async ({
      page,
    }) => {
      await openFixture(page, scheme);
      await expect(subject(page, 'reconciliation')).toHaveScreenshot(
        `reconciliation-proposed-${scheme}.png`
      );
    });

    test(`reconciliation session with accepted + rejected verdicts (${scheme})`, async ({
      page,
    }) => {
      await openFixture(page, scheme);
      // Drive verdicts through the public API (not pointer hover) so the
      // gutter buttons stay in their at-rest hidden state for the shot.
      const acceptedId = await page.evaluate(() => window.__applyVerdicts!());
      const recon = subject(page, 'reconciliation');
      await expect(
        recon.locator(`[data-recon-row][data-match-id="${acceptedId}"]`)
      ).toHaveAttribute('data-match-status', 'accepted');
      // A rejected match has no row of its own: the pair dissolves back into
      // its statement-only and book-only halves, so those unmatched rows ARE
      // the rejected visual state this shot protects.
      await expect(
        recon.locator('[data-recon-row][data-row-type="statement-only"]')
      ).toHaveCount(1);
      await expect(
        recon.locator('[data-recon-row][data-row-type="book-only"]')
      ).toHaveCount(1);
      await settle(page);
      await expect(subject(page, 'reconciliation')).toHaveScreenshot(
        `reconciliation-verdicts-${scheme}.png`
      );
    });

    test(`entry diff for a modified entry (${scheme})`, async ({ page }) => {
      await openFixture(page, scheme);
      await expect(subject(page, 'entry-diff')).toHaveScreenshot(
        `entry-diff-modified-${scheme}.png`
      );
    });
  });
}
