// Runs INSIDE Duet's cloud machine. One action per call, one line of JSON out.
//   node duet-browser.mjs <start|open|read|screenshot|click|type|press> '<json args>'
// A single Chromium stays open on the machine's desktop (DISPLAY :1, so the person can watch it),
// and each call attaches to it over the DevTools protocol on 127.0.0.1:9222.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 9222;
const HOME = process.env.HOME || '/data/home';
const PROFILE = `${HOME}/openduet/profile`;
const MAX_TEXT = 40_000;
const MAX_ELEMENTS = 150;

const [action, rawArgs = '{}'] = process.argv.slice(2);
const args = JSON.parse(rawArgs);
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

async function up() {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

async function start() {
  if (await up()) return 'already running';
  mkdirSync(PROFILE, { recursive: true });
  const child = spawn(
    process.env.CHROMIUM_BIN || '/usr/bin/chromium',
    [
      `--remote-debugging-port=${PORT}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--window-size=1280,800',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore', env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' } },
  );
  child.unref();
  for (let i = 0; i < 40; i++) {
    if (await up()) return 'started';
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Chromium did not start. Is the desktop running on the machine?');
}

async function withPage(fn) {
  if (!(await up())) await start();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages().at(-1) ?? (await context.newPage());
    return await fn(page);
  } finally {
    // Detaches; the browser itself keeps running.
    await browser.close();
  }
}

const where = async (page) => ({ url: page.url(), title: await page.title().catch(() => '') });

/** Visible interactive elements, each tagged with a ref the model can click or type into. */
async function snapshot(page) {
  return page.evaluate(
    ({ maxText, maxElements }) => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight * 3;
      };
      for (const old of document.querySelectorAll('[data-duet-ref]')) old.removeAttribute('data-duet-ref');
      const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[onclick],[contenteditable=true]';
      const elements = [];
      for (const el of document.querySelectorAll(sel)) {
        if (elements.length >= maxElements) break;
        if (!visible(el)) continue;
        const ref = elements.length + 1;
        el.setAttribute('data-duet-ref', String(ref));
        const label = (
          el.getAttribute('aria-label') ||
          el.labels?.[0]?.innerText ||
          el.innerText ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title') ||
          el.getAttribute('name') ||
          el.value ||
          el.getAttribute('alt') ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100);
        elements.push({
          ref,
          kind: el.tagName.toLowerCase() + (el.type && el.tagName === 'INPUT' ? `:${el.type}` : ''),
          label,
          ...(el.href ? { href: el.href.slice(0, 200) } : {}),
          ...(el.tagName === 'INPUT' && el.type === 'password' ? {} : el.value ? { value: String(el.value).slice(0, 60) } : {}),
        });
      }
      return { text: (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, maxText), elements };
    },
    { maxText: MAX_TEXT, maxElements: MAX_ELEMENTS },
  );
}

async function locate(page, ref) {
  const loc = page.locator(`[data-duet-ref="${Number(ref)}"]`).first();
  if ((await loc.count()) === 0) throw new Error(`There is no element [${Number(ref)}] on this page now. Read the page again to get the current numbers.`);
  return loc;
}

async function run() {
  switch (action) {
    case 'start':
      return { status: await start() };
    case 'open':
      return withPage(async (page) => {
        await page.goto(String(args.url), { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        return where(page);
      });
    case 'read':
      return withPage(async (page) => ({ ...(await where(page)), ...(await snapshot(page)) }));
    case 'screenshot':
      return withPage(async (page) => {
        const buf = await page.screenshot({ type: 'jpeg', quality: 60, timeout: 15_000 });
        return { ...(await where(page)), mime: 'image/jpeg', base64: buf.toString('base64') };
      });
    case 'click':
      return withPage(async (page) => {
        if (args.ref != null) await (await locate(page, args.ref)).click({ timeout: 10_000 });
        else await page.mouse.click(Number(args.x), Number(args.y));
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        return where(page);
      });
    case 'type':
      return withPage(async (page) => {
        if (args.ref != null) await (await locate(page, args.ref)).fill(String(args.text), { timeout: 10_000 });
        else await page.keyboard.type(String(args.text));
        if (args.submit) await page.keyboard.press('Enter');
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        return where(page);
      });
    case 'press':
      return withPage(async (page) => {
        await page.keyboard.press(String(args.key));
        return where(page);
      });
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

try {
  out({ ok: true, ...(await run()) });
} catch (err) {
  out({ ok: false, error: String(err?.message || err).split('\n')[0].slice(0, 300) });
}
process.exit(0);
