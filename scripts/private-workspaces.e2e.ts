import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  process.env.THREATDUET_HOME = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/duet-private-ui-`);
});
vi.mock('../src/server/notify.js', () => ({ notify: vi.fn() }));
const store = await import('../src/server/store.js');
const { requestInput, cancelInputs, openInputs } = await import('../src/server/input.js');
const { app } = await import('../src/server/app.js');
const { listen, closeServer } = await import('../src/server/listen.js');
let browser: Browser;
let server: Awaited<ReturnType<typeof listen>>;
let origin: string;
beforeAll(async () => {
  await store.openStore();
  store.db.data.setupDone = true;
  store.db.data.settings.language = 'en';
  store.db.data.channels = [{ id: 'separate-channel', name: 'Private topic', session: null, createdAt: Date.now() }];
  await store.db.write();
  server = await listen(app.fetch, '127.0.0.1', 0);
  origin = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(async () => { cancelInputs(); await browser?.close(); if (server) await closeServer(server.server); });

it('keeps inline prompts channel-owned and submits native autofill values without change events', async () => {
  const first = requestInput({ kind: 'password', prompt: 'First secure login', target: 'computer', url: 'https://first.example.com' });
  const second = requestInput({ kind: 'otp', prompt: 'Second secure login', target: 'computer', url: 'https://second.example.com' });
  const other = requestInput({ kind: 'text', prompt: 'Other channel login', target: 'computer', channel: 'separate-channel', url: 'https://other.example.com' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(origin);
  await vi.waitFor(async () => expect(await page.locator('.input-prompt-card').count()).toBe(2));
  const card = page.locator('.input-prompt-card').filter({ hasText: 'Second secure login' });
  const input = card.locator('input[name=credential]');
  await input.evaluate((element: HTMLInputElement) => { element.value = '654321'; });
  await card.getByRole('button', { name: 'Fill and continue', exact: true }).click();
  expect(await second).toBe('654321');
  expect(openInputs()).toHaveLength(2);
  expect(JSON.stringify(store.db.data)).not.toContain('654321');
  await page.getByRole('button', { name: '#Private topic', exact: true }).click();
  await vi.waitFor(async () => expect(await page.locator('.input-prompt-card').count()).toBe(1));
  expect(await page.locator('.input-prompt-card').textContent()).toContain('Other channel login');
  expect(await page.locator('.input-prompt-card').textContent()).not.toContain('First secure login');
  await page.locator('.input-prompt-card').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await other).toBeNull();
  await page.getByRole('button', { name: 'Main', exact: true }).click();
  await page.locator('.input-prompt-card').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await first).toBeNull();
  expect(failures).toEqual([]);
  await page.close();
});
