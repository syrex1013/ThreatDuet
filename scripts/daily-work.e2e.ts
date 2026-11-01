import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  process.env.THREATDUET_HOME = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/duet-ui-`);
});
const store = await import('../src/server/store.js');
const { app } = await import('../src/server/app.js');
const { listen, closeServer } = await import('../src/server/listen.js');
const { WORKSPACE } = await import('../src/server/config.js');
let browser: Browser;
let server: Awaited<ReturnType<typeof listen>>;
let url: string;

beforeAll(async () => {
  await store.openStore();
  store.db.data.setupDone = true;
  store.db.data.settings.language = 'en';
  await store.db.write();
  server = await listen(app.fetch, '127.0.0.1', 0);
  url = `http://127.0.0.1:${server.port}`;
  browser = await chromium.launch({ channel: 'chrome' });
});
afterAll(async () => { await browser?.close(); if (server) await closeServer(server.server); });

it('creates a project and task, corrects knowledge, checks mobile controls, uploads and restores a document', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  try {
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await page.getByLabel('Project name', { exact: true }).fill('Launch review');
  await page.getByLabel('Objective', { exact: true }).fill('Prepare launch material');
  await page.getByLabel('Completion criteria', { exact: true }).fill('Reviewed release notes');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('heading', { name: /Launch review/ }).first().waitFor();
  expect(store.db.data.projects[0].objective).toBe('Prepare launch material');
  await page.getByLabel('New milestone', { exact: true }).fill('Release notes');
  await page.getByRole('button', { name: 'Add milestone', exact: true }).click();
  await vi.waitFor(() => expect(store.db.data.projects[0].milestones).toHaveLength(1));
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Draft release notes');
  await page.getByLabel('Instructions', { exact: true }).fill('Use repository changes');
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.getByRole('heading', { name: /Draft release notes/ }).waitFor();
  expect(store.db.data.tasks[0].projectId).toBe(store.db.data.projects[0].id);
  await page.getByRole('button', { name: 'Knowledge', exact: true }).click();
  await page.getByLabel('Knowledge', { exact: true }).fill('Launch on Monday');
  await page.getByRole('button', { name: 'Save knowledge', exact: true }).click();
  await page.getByText('Launch on Monday', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByLabel('Knowledge', { exact: true }).fill('Launch on Tuesday');
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await page.getByText('Launch on Tuesday', { exact: true }).waitFor();
  expect(store.db.data.knowledge[0].text).toBe('Launch on Tuesday');
  await page.getByRole('button', { name: 'Forget', exact: true }).click();
  await vi.waitFor(() => expect(store.db.data.knowledge).toHaveLength(0));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('heading', { name: /Draft release notes/ }).waitFor();
  const width = await page.evaluate(() => ({ viewport: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.viewport);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Made by Duet', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'release.md', mimeType: 'text/markdown', buffer: Buffer.from('# First revision\n') });
  await page.getByRole('heading', { name: 'First revision', exact: true }).waitFor();
  const revision = store.db.data.revisions.find((r) => r.source === 'uploaded release.md')!;
  expect(revision).toBeDefined();
  await fs.writeFile(path.join(WORKSPACE, revision.path), '# Second revision\n');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Made by Duet', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(revision.path) }).click();
  await page.getByRole('heading', { name: 'Second revision', exact: true }).waitFor();
  await page.getByLabel('Revision history', { exact: true }).selectOption(revision.id);
  await page.getByText('Selected revision compared with current file', { exact: true }).waitFor();
  expect(await page.locator('.revision-diff').textContent()).toContain('- # First revision');
  await page.getByRole('button', { name: 'Restore selected revision', exact: true }).click();
  await page.getByRole('heading', { name: 'First revision', exact: true }).waitFor();
  expect(await fs.readFile(path.join(WORKSPACE, revision.path), 'utf8')).toBe('# First revision\n');
  expect(errors).toEqual([]);
  } finally {
    await page.screenshot({ path: path.join(os.tmpdir(), 'openduet-daily-work.png'), fullPage: true });
    await page.close();
  }
});
