import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserId, MacStatus } from '../../shared/types.js';
import { writeConnectorsConfig } from '../connectors.js';
import { db, writeWorkspaceConfig } from '../store.js';
import { tr } from '../i18n.js';
import { browserChoices, browserRunning, stopBrowser } from './browser.js';
import { fullDiskAccess, OS_ID } from './os.js';

export async function macStatus(): Promise<MacStatus> {
  const { files, everything, folders, shell, browser, browserApp, auto } = db.data.mac;
  return { os: OS_ID, files, everything, fullDisk: await fullDiskAccess(), folders, shell, browser, auto, browserApp, browsers: await browserChoices(), browserRunning: browserRunning() };
}

/** Rewrites the configs Kilo reads, so a change applies from the next turn. */
async function save(): Promise<void> {
  await db.write();
  await writeConnectorsConfig();
  await writeWorkspaceConfig();
}

export async function setMac(patch: { files?: boolean; everything?: boolean; shell?: boolean; browser?: boolean; browserApp?: 'auto' | BrowserId; auto?: boolean }): Promise<void> {
  Object.assign(db.data.mac, patch);
  // Turning the browser off, or picking another one, forgets the copy of the sign-ins.
  if (patch.browser === false || patch.browserApp) await stopBrowser();
  await save();
}

export async function addFolder(raw: string): Promise<{ ok: true } | { error: string }> {
  const input = raw.trim().startsWith('~') ? path.join(os.homedir(), raw.trim().slice(1)) : raw.trim();
  if (!path.isAbsolute(input)) return { error: tr(process.platform === 'win32' ? 'Use a full path, like C:\\Users\\you\\Documents or ~/Documents.' : 'Use a full path, like ~/Documents.') };
  const real = await fs.realpath(input).catch(() => null);
  if (!real || !(await fs.stat(real)).isDirectory()) return { error: tr('That folder does not exist.') };
  if (!db.data.mac.folders.includes(real)) db.data.mac.folders.push(real);
  await save();
  return { ok: true };
}

export async function removeFolder(folder: string): Promise<void> {
  db.data.mac.folders = db.data.mac.folders.filter((f) => f !== folder);
  await save();
}

/** Stops Brave and deletes the copy; the next browsing copies the current sign-ins again. */
export async function resyncBrowser(): Promise<void> {
  await stopBrowser();
}
