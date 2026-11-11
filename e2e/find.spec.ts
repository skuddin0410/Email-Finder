import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('single lookup: LinkedIn URL finds the verified mailbox', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('LinkedIn profile URL').fill('https://www.linkedin.com/in/jane-doe-4b2c91a7/');
  await page.getByLabel('Company domain').fill('https://www.known.test/about');
  await page.getByRole('button', { name: 'Find email' }).click();
  const result = page.getByRole('region', { name: 'Result' });
  await expect(result.getByText('jane.doe@known.test')).toBeVisible();
  await expect(result.locator('.badge.valid').first()).toBeVisible();
});

test('single lookup: catch-all domain shows risky result and warning', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Full name').fill('Jane Doe');
  await page.getByLabel('Company domain').fill('catchall.test');
  await page.getByRole('button', { name: 'Find email' }).click();
  const result = page.getByRole('region', { name: 'Result' });
  await expect(result.getByText(/catch-all/i)).toBeVisible();
  await expect(result.locator('.badge.risky').first()).toBeVisible();
});

test('single lookup: unreachable SMTP shows the unavailable banner', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Full name').fill('Jane Doe');
  await page.getByLabel('Company domain').fill('down.test');
  await page.getByRole('button', { name: 'Find email' }).click();
  await expect(page.getByText(/verification unavailable/i)).toBeVisible();
});

test('single lookup: bad LinkedIn URL shows an error alert', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('LinkedIn profile URL').fill('https://www.linkedin.com/company/acme');
  await page.getByLabel('Company domain').fill('known.test');
  await page.getByRole('button', { name: 'Find email' }).click();
  await expect(page.getByRole('alert')).toContainText('Not a LinkedIn profile URL');
});

test('bulk CSV round trip: 2 results + 1 error row, downloadable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /bulk/i }).click();
  const csv = 'name,domain\nJane Doe,known.test\n,known.test\nAnn Lee,known.test\n';
  await page.getByLabel('CSV file').setInputFiles({ name: 'in.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: /run bulk/i }).click();
  const table = page.getByRole('region', { name: 'Bulk results' });
  await expect(table.getByText('jane.doe@known.test')).toBeVisible();
  await expect(table.getByText('ann.lee@known.test')).toBeVisible();
  await expect(table.getByText('Row needs a url or name')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), table.getByRole('link', { name: /download results/i }).click()]);
  const text = readFileSync((await download.path())!, 'utf8');
  expect(text).toContain('jane.doe@known.test');
  expect(text).toContain('ann.lee@known.test');
  expect(text).toContain('Row needs a url or name');
});
