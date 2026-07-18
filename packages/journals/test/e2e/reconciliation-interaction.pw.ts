import { expect, type Locator, type Page, test } from '@playwright/test';

declare global {
  interface Window {
    __reconciliationReady?: boolean;
    __matchIds?: string[];
    __recon?: { getState(): { difference: Map<string, number> } };
  }
}

// Theme jade (--journals-reconciled) for the light scheme, which the suite
// pins via emulated OS preference: light-dark(#18a46c, #60d199).
const JADE_LIGHT = 'rgb(24, 164, 108)';

async function openFixture(page: Page): Promise<string[]> {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/test/e2e/fixtures/reconciliation-interaction.html');
  await page.waitForFunction(() => window.__reconciliationReady === true);
  return page.evaluate(() => window.__matchIds!);
}

function matchRow(page: Page, matchId: string): Locator {
  return page.locator(
    `journals-container [data-recon-row][data-match-id="${matchId}"]`
  );
}

function differenceValue(page: Page): Locator {
  return page.locator(
    'journals-container [data-recon-figure="difference"] [data-figure-value]'
  );
}

function cellBackground(row: Locator): Promise<string> {
  return row
    .locator('[data-recon-cell="statement"]')
    .evaluate((cell) => getComputedStyle(cell).backgroundColor);
}

test.describe('reconciliation real-browser interaction', () => {
  test('hovering a match row reveals the gutter action buttons', async ({
    page,
  }) => {
    const [firstId] = await openFixture(page);
    const row = matchRow(page, firstId);
    const accept = row.locator('[data-recon-action="accept"]');
    const reject = row.locator('[data-recon-action="reject"]');

    // At rest (pointer parked away from the row) the buttons are invisible.
    await page.mouse.move(0, 0);
    await expect(accept).toHaveCSS('opacity', '0');
    await expect(reject).toHaveCSS('opacity', '0');

    await row.hover();
    // toHaveCSS retries through the 140ms fade-in transition.
    await expect(accept).toHaveCSS('opacity', '1');
    await expect(reject).toHaveCSS('opacity', '1');
  });

  test('accepting a match changes the difference and tints the row', async ({
    page,
  }) => {
    const [firstId, secondId] = await openFixture(page);
    const firstRow = matchRow(page, firstId);

    const differenceBefore = await differenceValue(page).innerText();
    const proposedBackground = await cellBackground(firstRow);

    await firstRow.hover();
    await firstRow.locator('[data-recon-action="accept"]').click();

    await expect(matchRow(page, firstId)).toHaveAttribute(
      'data-match-status',
      'accepted'
    );
    await expect(differenceValue(page)).not.toHaveText(differenceBefore);

    // Accepted rows take the jade-mixed tint; a still-proposed row keeps the
    // indigo match tint — the two computed backgrounds must differ.
    const acceptedBackground = await cellBackground(matchRow(page, firstId));
    const stillProposedBackground = await cellBackground(
      matchRow(page, secondId)
    );
    expect(acceptedBackground).not.toBe(proposedBackground);
    expect(acceptedBackground).not.toBe(stillProposedBackground);
  });

  test('full acceptance reconciles the difference to jade zero', async ({
    page,
  }) => {
    const matchIds = await openFixture(page);

    for (const matchId of matchIds) {
      const row = matchRow(page, matchId);
      await row.hover();
      await row.locator('[data-recon-action="accept"]').click();
      await expect(matchRow(page, matchId)).toHaveAttribute(
        'data-match-status',
        'accepted'
      );
    }

    const difference = page.locator(
      'journals-container [data-recon-figure="difference"]'
    );
    await expect(difference).toHaveAttribute('data-difference', 'zero');
    await expect(differenceValue(page)).toHaveCSS('color', JADE_LIGHT);

    // The data layer agrees: every currency difference is exactly zero.
    const zero = await page.evaluate(() => {
      const { difference: byCurrency } = window.__recon!.getState();
      return [...byCurrency.values()].every((amount) => amount === 0);
    });
    expect(zero).toBe(true);
  });

  test('undo restores the proposed state and the difference figure', async ({
    page,
  }) => {
    const [firstId] = await openFixture(page);
    const differenceBefore = await differenceValue(page).innerText();

    const row = matchRow(page, firstId);
    await row.hover();
    await row.locator('[data-recon-action="accept"]').click();
    await expect(matchRow(page, firstId)).toHaveAttribute(
      'data-match-status',
      'accepted'
    );
    await expect(differenceValue(page)).not.toHaveText(differenceBefore);

    const accepted = matchRow(page, firstId);
    await accepted.hover();
    await accepted.locator('[data-recon-action="undo"]').click();

    await expect(matchRow(page, firstId)).toHaveAttribute(
      'data-match-status',
      'proposed'
    );
    await expect(differenceValue(page)).toHaveText(differenceBefore);
  });
});
