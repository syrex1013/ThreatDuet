import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import PQueue from 'p-queue';
import { chromium, type BrowserContext, type Cookie, type Page } from 'playwright-core';
import type { BrowserChoice, BrowserId } from '../../shared/types.js';
import { DATA_DIR, log } from '../config.js';
import { db } from '../store.js';

const WIN = process.platform === 'win32';
const HOME = os.homedir();
/** Picks the Windows, macOS or Linux value. */
const byOs = <T>(win: T, mac: T, linux: T): T => (WIN ? win : process.platform === 'darwin' ? mac : linux);
const CONFIG = process.env.XDG_CONFIG_HOME ?? path.join(HOME, '.config');
const LOCAL = process.env.LOCALAPPDATA ?? path.join(HOME, 'AppData', 'Local');
const ROAMING = process.env.APPDATA ?? path.join(HOME, 'AppData', 'Roaming');
const MAC_SUPPORT = path.join(HOME, 'Library', 'Application Support');
const programs = (...parts: string[]) => [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], LOCAL].filter(Boolean).map((d) => path.join(d as string, ...parts));

interface BrowserDef {
  id: BrowserId;
  name: string;
  family: 'chromium' | 'firefox';
  exes: string[];
  /** Chromium: the "User Data" folder. Firefox: the folder holding profiles.ini. */
  dataDir: string;
}

const DEFS: BrowserDef[] = [
  {
    id: 'brave',
    name: 'Brave',
    family: 'chromium',
    exes: byOs(programs('BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'], ['/usr/bin/brave-browser', '/usr/bin/brave', '/opt/brave.com/brave/brave']),
    dataDir: byOs(path.join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data'), path.join(MAC_SUPPORT, 'BraveSoftware', 'Brave-Browser'), path.join(CONFIG, 'BraveSoftware', 'Brave-Browser')),
  },
  {
    id: 'chrome',
    name: 'Chrome',
    family: 'chromium',
    exes: byOs(programs('Google', 'Chrome', 'Application', 'chrome.exe'), ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'], ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/chrome']),
    dataDir: byOs(path.join(LOCAL, 'Google', 'Chrome', 'User Data'), path.join(MAC_SUPPORT, 'Google', 'Chrome'), path.join(CONFIG, 'google-chrome')),
  },
  {
    id: 'firefox',
    name: 'Firefox',
    family: 'firefox',
    exes: byOs(programs('Mozilla Firefox', 'firefox.exe'), ['/Applications/Firefox.app/Contents/MacOS/firefox'], ['/usr/bin/firefox', '/usr/lib/firefox/firefox', '/snap/bin/firefox']),
    dataDir: byOs(path.join(ROAMING, 'Mozilla', 'Firefox'), path.join(MAC_SUPPORT, 'Firefox'), path.join(HOME, '.mozilla', 'firefox')),
  },
];
const def = (id: BrowserId) => DEFS.find((d) => d.id === id) as BrowserDef;

// A copy of the person's sign-ins, inside the private data folder. Never in the workspace.
const LEGACY_PROFILE = path.join(DATA_DIR, 'browser-profile');
let PROFILE = LEGACY_PROFILE;
const MAX_TEXT = 40_000;
const MAX_ELEMENTS = 150;

let ctx: BrowserContext | null = null;
let starting: Promise<BrowserContext> | null = null;
let usingName = '';
let interactive = false;
const queue = new PQueue({ concurrency: 1 });

const exists = (p: string) => fs.access(p).then(() => true, () => false);
async function exeOf(d: BrowserDef): Promise<string | null> {
  for (const e of d.exes) if (await exists(e)) return e;
  return null;
}

export async function browserChoices(): Promise<BrowserChoice[]> {
  return Promise.all(DEFS.map(async (d) => ({ id: d.id, name: d.name, installed: (await exeOf(d)) !== null })));
}

/** The browser to take sign-ins from: the chosen one, or the first installed. */
async function chosen(): Promise<BrowserDef> {
  const want = db.data.mac.browserApp;
  const list = await browserChoices();
  const id = want !== 'auto' && list.find((b) => b.id === want)?.installed ? want : list.find((b) => b.installed)?.id;
  if (!id) throw new Error('No supported browser (Brave, Chrome or Firefox) is installed.');
  return def(id);
}

/** Safe copy of a live SQLite file (Node's own sqlite; the original is only read). */
async function backupDb(from: string, dest: string): Promise<boolean> {
  try {
    const { DatabaseSync, backup } = await import('node:sqlite');
    const src = new DatabaseSync(from, { readOnly: true });
    try {
      await backup(src, dest);
    } finally {
      src.close();
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Chromium browsers: copies only the cookie database from the profile used last. The values are never read
 * here: they are encrypted with the browser's own key (Keychain / DPAPI) and only that browser can open them.
 */
async function copyChromiumCookies(d: BrowserDef): Promise<void> {
  const state = JSON.parse(await fs.readFile(path.join(d.dataDir, 'Local State'), 'utf8').catch(() => '{}'));
  const name: string = state?.profile?.last_used ?? 'Default';
  const src = [path.join(d.dataDir, name, 'Network', 'Cookies'), path.join(d.dataDir, name, 'Cookies')];
  const from = (await Promise.all(src.map((p) => fs.stat(p).then(() => p, () => null)))).find(Boolean);
  if (!from) throw new Error(`Couldn't find ${d.name}'s cookies. Open ${d.name} and sign in to a site once, then try again.`);
  await fs.mkdir(path.join(PROFILE, 'Default'), { recursive: true, mode: 0o700 });
  if (!(await backupDb(from, path.join(PROFILE, 'Default', 'Cookies')))) throw new Error(`Couldn't copy ${d.name}'s sign-ins. Close ${d.name} and try again.`);
  await fs.copyFile(path.join(d.dataDir, 'Local State'), path.join(PROFILE, 'Local State')).catch(() => undefined);
}

/** The profile Firefox uses by default, from profiles.ini. */
async function firefoxProfile(d: BrowserDef): Promise<string> {
  const ini = await fs.readFile(path.join(d.dataDir, 'profiles.ini'), 'utf8').catch(() => '');
  const sections = ini.split(/\r?\n(?=\[)/).map((s) => Object.fromEntries(s.split(/\r?\n/).slice(1).map((l) => l.split(/=(.*)/s).slice(0, 2)).filter((kv) => kv[1] !== undefined)) as Record<string, string>);
  const heads = ini.split(/\r?\n(?=\[)/).map((s) => s.split(/\r?\n/)[0]);
  const byInstall = sections.find((_, i) => /^\[Install/.test(heads[i]) && sections[i].Default);
  const flagged = sections.find((s, i) => /^\[Profile/.test(heads[i]) && s.Default === '1');
  const rel = byInstall?.Default ?? flagged?.Path;
  const relative = byInstall ? true : flagged?.IsRelative !== '0';
  if (!rel) throw new Error("Couldn't find Firefox's profile. Open Firefox and sign in to a site once, then try again.");
  return relative ? path.join(d.dataDir, rel) : rel;
}

/** Firefox keeps cookies unencrypted. They go straight into the browser we drive and are never shown to Duet. */
async function firefoxCookies(d: BrowserDef): Promise<Cookie[]> {
  const profile = await firefoxProfile(d);
  const tmp = path.join(PROFILE, 'firefox-cookies.sqlite');
  await fs.mkdir(PROFILE, { recursive: true, mode: 0o700 });
  if (!(await backupDb(path.join(profile, 'cookies.sqlite'), tmp))) throw new Error("Couldn't copy Firefox's sign-ins. Close Firefox and try again.");
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const q = new DatabaseSync(tmp, { readOnly: true });
    try {
      const rows = q.prepare("SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE originAttributes = ''").all() as Record<string, string | number>[];
      const now = Date.now() / 1000;
      return rows
        .map((r) => {
          const expiry = Number(r.expiry);
          const seconds = expiry > 1e11 ? expiry / 1000 : expiry;
          return {
            name: String(r.name),
            value: String(r.value),
            domain: String(r.host),
            path: String(r.path),
            expires: seconds > 0 ? seconds : -1,
            httpOnly: Boolean(r.isHttpOnly),
            secure: Boolean(r.isSecure),
            sameSite: (r.sameSite === 2 ? 'Strict' : r.sameSite === 1 ? 'Lax' : 'None') as Cookie['sameSite'],
          };
        })
        .filter((c) => c.expires === -1 || c.expires > now);
    } finally {
      q.close();
    }
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

async function profileReady(): Promise<boolean> {
  // A previous ThreatDuet browse left a Chromium profile (or Firefox-cookie inject left Default/).
  try {
    const entries = await fs.readdir(PROFILE);
    return entries.length > 0;
  } catch {
    return false;
  }
}

async function context(opts: { refreshSignins?: boolean } = {}): Promise<BrowserContext> {
  if (ctx && !opts.refreshSignins) return ctx;
  if (opts.refreshSignins && ctx) {
    const old = ctx;
    ctx = null;
    await old.close().catch(() => undefined);
  }
  starting ??= (async () => {
    const src = await chosen();
    PROFILE = path.join(DATA_DIR, 'browser-profiles', src.id);
    if (!(await exists(PROFILE)) && await exists(LEGACY_PROFILE)) {
      await fs.mkdir(path.dirname(PROFILE), { recursive: true, mode: 0o700 });
      await fs.rename(LEGACY_PROFILE, PROFILE);
    }
    // Firefox can't be driven directly, so Chrome or Brave carries its sign-ins.
    const engine = src.family === 'firefox' ? (await Promise.all(DEFS.filter((x) => x.family === 'chromium').map(async (x) => ((await exeOf(x)) ? x : null)))).find(Boolean) : src;
    if (!engine) throw new Error('Firefox sign-ins need Chrome or Brave installed to browse with.');
    const exe = (await exeOf(engine)) as string;
    // Keep the profile across launches so passwords typed in the prompt and site sessions survive.
    // Only wipe when the user asks to reload sign-ins from their own browser.
    const reuse = !opts.refreshSignins && (await profileReady());
    let cookies: Cookie[] = [];
    if (!reuse) {
      await fs.rm(PROFILE, { recursive: true, force: true });
      await fs.mkdir(PROFILE, { recursive: true, mode: 0o700 });
      await fs.chmod(PROFILE, 0o700);
      cookies = src.family === 'firefox' ? await firefoxCookies(src) : (await copyChromiumCookies(src), []);
    }
    // Talks to the browser over a pipe, not a network port, so no other program can attach and read the cookies.
    // The real Keychain / keyring is kept (Playwright's mock keychain and basic password store would make every cookie unreadable).
    const c = await chromium.launchPersistentContext(PROFILE, { executablePath: exe, headless: !interactive, args: ['--restore-last-session'], ignoreDefaultArgs: ['--use-mock-keychain', '--password-store=basic'] });
    for (let i = 0; i < cookies.length; i += 200) await c.addCookies(cookies.slice(i, i + 200)).catch(() => undefined);
    c.on('page', (p) => p.on('dialog', (d) => void d.dismiss().catch(() => undefined)));
    c.on('close', () => {
      if (ctx === c) { ctx = null; interactive = false; }
    });
    usingName = src.family === 'firefox' ? `${src.name} sign-ins in ${engine.name}` : src.name;
    ctx = c;
    return c;
  })().finally(() => {
    starting = null;
  });
  return starting;
}

/** Closing the browser preserves its complete private profile. Forgetting sessions is explicit. */
export async function stopBrowser(): Promise<void> {
  const c = ctx;
  ctx = null;
  await c?.close().catch(() => undefined);
  interactive = false;
}

export async function forgetBrowserSessions(): Promise<void> {
  await stopBrowser();
  await fs.rm(path.join(DATA_DIR, 'browser-profiles'), { recursive: true, force: true });
  await fs.rm(LEGACY_PROFILE, { recursive: true, force: true });
  await fs.rm(path.join(DATA_DIR, 'brave-profile'), { recursive: true, force: true });
}

export const browserRunning = () => (ctx ? usingName : null);
export const browserInteractive = () => interactive;
export async function takeoverBrowser(): Promise<void> {
  interactive = true;
  await queue.add(async () => {
    const pages = ctx?.pages().map((p) => p.url()).filter((u) => u && u !== 'about:blank') ?? [];
    const old = ctx; ctx = null;
    await old?.close().catch(() => undefined);
    const visible = await context();
    // Persistent Chromium may restore extra blank tabs. Rebuild from known URLs and keep the last as active.
    for (const tab of visible.pages().slice()) {
      if (tab.url() === 'about:blank' && visible.pages().length > 1) await tab.close().catch(() => undefined);
    }
    for (const [index, url] of pages.entries()) {
      const tab = visible.pages()[index] ?? await visible.newPage();
      if (tab.url() !== url) await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await tab.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
    }
    const active = visible.pages().at(-1);
    if (active) await active.bringToFront().catch(() => undefined);
  });
}
export async function finishTakeover(): Promise<void> {
  await queue.add(async () => {
    const pages = ctx?.pages().map((p) => p.url()).filter((u) => u && u !== 'about:blank') ?? [];
    const old = ctx; ctx = null;
    await old?.close().catch(() => undefined);
    interactive = false;
    if (!pages.length) return;
    // Return to headless automation with the same tabs when possible.
    const restored = await context();
    for (const [index, url] of pages.entries()) {
      const tab = restored.pages()[index] ?? await restored.newPage();
      if (tab.url() !== url) await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
    }
  });
}

async function page(refreshSignins = false): Promise<Page> {
  const c = await context({ refreshSignins });
  return c.pages().at(-1) ?? (await c.newPage());
}

const where = async (p: Page) => ({ url: p.url(), title: await p.title().catch(() => '') });

/** Same page reader as Duet's cloud computer: visible text plus numbered clickable elements. */
async function snapshot(p: Page) {
  return p.evaluate(
    ({ maxText, maxElements }) => {
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight * 3;
      };
      const textOf = (element: Element | null): string => {
        if (!element) return '';
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const parts: string[] = [];
        let lastBlock: Element | null = null;
        let length = 0;
        while (walker.nextNode() && length < maxText) {
          const node = walker.currentNode;
          const parent = node.parentElement;
          if (!parent || parent.closest('input,textarea,select,[contenteditable=true],[data-duet-sensitive],script,style,[hidden]') || (!parent.getClientRects().length && getComputedStyle(parent).display !== 'contents')) continue;
          const value = node.textContent?.trim() ?? '';
          if (value) {
            const block = parent.closest('p,div,li,h1,h2,h3,h4,h5,h6,tr,section,article,header,footer,nav,main,aside,form,pre,blockquote,td,th');
            if (parts.length && block === lastBlock) parts[parts.length - 1] += ` ${value}`; else parts.push(value);
            lastBlock = block;
            length += value.length;
          }
        }
        return parts.join('\n').slice(0, maxText);
      };
      for (const old of document.querySelectorAll('[data-duet-ref]')) old.removeAttribute('data-duet-ref');
      const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[onclick],[contenteditable=true]';
      const elements: { ref: number; kind: string; label: string; href?: string; value?: string }[] = [];
      for (const el of document.querySelectorAll<HTMLElement & { value?: string; href?: string; type?: string; labels?: NodeListOf<HTMLElement> }>(sel)) {
        if (elements.length >= maxElements) break;
        if (!visible(el)) continue;
        const ref = elements.length + 1;
        el.setAttribute('data-duet-ref', String(ref));
        const label = (el.getAttribute('aria-label') || textOf(el.labels?.[0] ?? null) || textOf(el) || (el.tagName === 'INPUT' && /^(submit|button|reset)$/.test(el.type ?? '') ? el.value : '') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 100);
        elements.push({
          ref,
          kind: el.tagName.toLowerCase() + (el.type && el.tagName === 'INPUT' ? `:${el.type}` : ''),
          label,
          ...(el.href ? { href: el.href.slice(0, 200) } : {}),
          // Never expose current input values: text fields can contain usernames or secrets too.
        });
      }
      return { text: textOf(document.body), elements };
    },
    { maxText: MAX_TEXT, maxElements: MAX_ELEMENTS },
  );
}

async function locate(p: Page, ref: number) {
  const loc = p.locator(`[data-duet-ref="${Number(ref)}"]`).first();
  if ((await loc.count()) === 0) throw new Error(`There is no element [${ref}] on this page now. Read the page again to get the current numbers.`);
  return loc;
}

export type BrowseResult = { url: string; title: string; token?: string; text?: string; elements?: { ref: number; kind: string; label: string; href?: string; value?: string }[]; mime?: string; base64?: string };

/** One action at a time, so Duet's steps never interleave. */
/** Cookies from the persisted ThreatDuet browser profile (for moving a session to Instabox). Values never go to the model. */
export type SessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
};

export async function exportCookies(origin?: string): Promise<SessionCookie[]> {
  return queue.add(async () => {
    const c = await context();
    const raw = await c.cookies();
    const allowed = origin ? new URL(origin).hostname : null;
    return raw.filter((k) => !allowed || k.domain.replace(/^\./, '') === allowed || allowed.endsWith(`.${k.domain.replace(/^\./, '')}`)).map((k) => ({
      name: k.name,
      value: k.value,
      domain: k.domain,
      path: k.path,
      expires: k.expires ?? -1,
      httpOnly: Boolean(k.httpOnly),
      secure: Boolean(k.secure),
      sameSite: (k.sameSite === 'Strict' || k.sameSite === 'Lax' || k.sameSite === 'None' ? k.sameSite : 'Lax') as SessionCookie['sameSite'],
    }));
  });
}

export function browse(
  action: 'open' | 'read' | 'screenshot' | 'click' | 'type' | 'press' | 'scroll' | 'signins' | 'inspect-input' | 'fill-input',
  args: { url?: string; ref?: number; token?: string; text?: string; submit?: boolean; key?: string; pixels?: number; x?: number; y?: number; manual?: boolean } = {},
): Promise<BrowseResult> {
  return queue.add(async () => {
    if (interactive && !args.manual) throw new Error('Browser takeover is active. Automation is paused until takeover ends.');
    // The user just signed in somewhere in their own browser: copy those sign-ins again (drops the old copy).
    const p = action === 'signins' ? await page(true) : await page();
    if (action === 'inspect-input') {
      const el = await locate(p, Number(args.ref));
      const token = await el.evaluate((node) => {
        const w = window as Window & { __duetNonce?: string; __duetBindings?: Map<string, { node: Element; signature: string }> };
        w.__duetNonce ??= crypto.randomUUID();
        const token = crypto.randomUUID();
        w.__duetBindings ??= new Map();
        w.__duetBindings.set(token, { node, signature: [node.tagName, node.getAttribute('name'), node.getAttribute('type'), node.getAttribute('autocomplete')].join('|') });
        node.setAttribute('data-duet-input-token', token);
        return `${w.__duetNonce}:${token}`;
      });
      return { ...(await where(p)), token } as BrowseResult;
    }
    if (action === 'fill-input') {
      const current = await where(p);
      const token = String(args.token ?? '');
      if (!token || !token.includes(':') || current.url !== String(args.url ?? current.url)) throw new Error('The page changed while waiting for input.');
      const nonce = token.split(':', 1)[0];
      const ok = await p.evaluate((n) => (window as Window & { __duetNonce?: string }).__duetNonce === n, nonce);
      if (!ok) throw new Error('The page changed while waiting for input.');
      const fieldToken = token.slice(token.indexOf(':') + 1);
      const field = p.locator(`[data-duet-input-token="${fieldToken}"]`).first();
      const handle = await field.elementHandle();
      if (!handle || await field.count() !== 1) throw new Error('The page changed while waiting for input.');
      const original = await handle.evaluate((node, token) => {
        const binding = (window as Window & { __duetBindings?: Map<string, { node: Element; signature: string }> }).__duetBindings?.get(token);
        return binding?.node === node && binding.signature === [node.tagName, node.getAttribute('name'), node.getAttribute('type'), node.getAttribute('autocomplete')].join('|');
      }, fieldToken);
      if (!original) throw new Error('The field changed while waiting for input.');
      try { await handle.fill(String(args.text), { timeout: 10_000 }); }
      catch { throw new Error('Credential field could not be filled. Inspect the page and request fresh input.'); }
      await p.evaluate((token) => (window as Window & { __duetBindings?: Map<string, unknown> }).__duetBindings?.delete(token), fieldToken);
      await handle.evaluate((node) => node.setAttribute('data-duet-sensitive', 'true'));
      if (args.submit) await p.keyboard.press('Enter');
      return where(p);
    }
    switch (action) {
      case 'open':
        await p.goto(String(args.url), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
        return where(p);
      case 'read':
        return { ...(await where(p)), ...(await snapshot(p)) };
      case 'screenshot': {
        // The user's own live view must show what they type; only model-facing shots are masked.
        const masks = args.manual ? [] : p.frames().map((frame) => frame.locator('input,textarea,[contenteditable="true"],[data-duet-sensitive]'));
        const buf = await p.screenshot({ type: 'jpeg', quality: 60, timeout: 15_000, mask: masks, maskColor: '#777777' });
        return { ...(await where(p)), mime: 'image/jpeg', base64: buf.toString('base64') };
      }
      case 'click':
        // Element number (Duet) or pixel click (Watch / credential prompt on Mac/Windows/Linux).
        if (args.ref != null) await (await locate(p, Number(args.ref))).click({ timeout: 10_000 });
        else await p.mouse.click(Number(args.x), Number(args.y));
        await p.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined);
        return (await context()).pages().at(-1) ? where((await context()).pages().at(-1) as Page) : where(p);
      case 'type':
        if (args.ref != null) await (await locate(p, Number(args.ref))).fill(String(args.text), { timeout: 10_000 });
        else await p.keyboard.type(String(args.text));
        if (args.submit) await p.keyboard.press('Enter');
        await p.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined);
        return where(p);
      case 'press':
        await p.keyboard.press(String(args.key));
        return where(p);
      case 'signins':
        return where(p);
      case 'scroll':
        await p.evaluate((px: number) => { window.scrollBy(0, px); }, Number(args.pixels ?? 500));
        return where(p);
    }
  }) as Promise<BrowseResult>;
}
