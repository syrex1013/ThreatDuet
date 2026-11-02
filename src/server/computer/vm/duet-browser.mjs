// Runs INSIDE Duet's cloud machine. One action per call, one line of JSON out.
//   node duet-browser.mjs <start|open|read|screenshot|click|type|press|cookies> '<json args>'
// A single Chromium stays open on the machine's desktop (DISPLAY :1, so the person can watch it),
// and each call attaches to it over the DevTools protocol on 127.0.0.1:9222.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 9222;
const HOME = process.env.HOME || '/data/home';
const PROFILE = `${HOME}/threatduet/profile`;
const MAX_TEXT = 40_000;
const MAX_ELEMENTS = 150;

const [action, rawArgs = '{}'] = process.argv.slice(2);
const args = JSON.parse(rawArgs === '-' ? readFileSync(0, 'utf8') : rawArgs);
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
      '--restore-last-session',
      '--disable-session-crashed-bubble',
      '--disable-quic',
      ...(process.env.CHROMIUM_PROXY ? [`--proxy-server=${process.env.CHROMIUM_PROXY}`, '--proxy-bypass-list=<-loopback>'] : []),
      ...(process.env.DUET_GVISOR === '1' ? ['--no-sandbox'] : []),
      '--start-maximized',
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

/** Session-only cookies die with Chromium (machine restart, crash). An expiry makes a sign-in last. */
async function pin(context) {
  const expires = Math.floor(Date.now() / 1000) + 30 * 86400;
  const session = (await context.cookies()).filter((c) => c.expires === -1).map((c) => ({ ...c, expires }));
  for (let i = 0; i < session.length; i += 200) await context.addCookies(session.slice(i, i + 200));
}

async function withPage(fn) {
  if (!(await up())) await start();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages().at(-1) ?? (await context.newPage());
    const result = await fn(page);
    if (!['read', 'screenshot', 'inspect-input'].includes(action)) await pin(context).catch(() => {});
    return result;
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
      const textOf = (element) => {
        if (!element) return '';
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const parts = [];
        let lastBlock = null;
        let length = 0;
        while (walker.nextNode() && length < maxText) {
          const node = walker.currentNode;
          const parent = node.parentElement;
          if (!parent || parent.closest('input,textarea,select,[contenteditable=true],[data-duet-sensitive],script,style,[hidden]') || (!parent.getClientRects().length && getComputedStyle(parent).display !== 'contents')) continue;
          const value = node.textContent?.trim() || '';
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
      const elements = [];
      for (const el of document.querySelectorAll(sel)) {
        if (elements.length >= maxElements) break;
        if (!visible(el)) continue;
        const ref = elements.length + 1;
        el.setAttribute('data-duet-ref', String(ref));
        const label = (
          el.getAttribute('aria-label') ||
          textOf(el.labels?.[0] ?? null) ||
          textOf(el) ||
          (el.tagName === 'INPUT' && /^(submit|button|reset)$/.test(el.type) ? el.value : '') ||
          el.getAttribute('placeholder') ||
          el.getAttribute('title') ||
          el.getAttribute('name') ||
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
        });
      }
      return { text: textOf(document.body), elements };
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
        // The user's own live view must show what they type; only model-facing shots are masked.
        const masks = args.manual ? [] : page.frames().map((frame) => frame.locator('input,textarea,[contenteditable="true"],[data-duet-sensitive]'));
        const buf = await page.screenshot({ type: 'jpeg', quality: 60, timeout: 15_000, mask: masks, maskColor: '#777777' });
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
    case 'inspect-input':
      return withPage(async (page) => {
        const binding = await (await locate(page, args.ref)).evaluate((node) => {
          window.__duetNonce ||= crypto.randomUUID();
          const token = crypto.randomUUID();
          window.__duetBindings ||= new Map();
          window.__duetBindings.set(token, { node, signature: [node.tagName, node.getAttribute('name'), node.getAttribute('type'), node.getAttribute('autocomplete')].join('|') });
          node.setAttribute('data-duet-input-token', token);
          const input = node;
          const hints = [node.getAttribute('name'), node.getAttribute('id'), node.getAttribute('placeholder'), node.getAttribute('aria-label'), input.autocomplete].join(' ').toLowerCase();
          const kind = input.type === 'password' ? 'password' : input.autocomplete === 'one-time-code' || /one.?time|otp|verification code/.test(hints) ? 'otp' : input.type === 'email' || input.autocomplete === 'email' || /e.?mail/.test(hints) ? 'email' : input.autocomplete === 'username' || /user.?name|login/.test(hints) ? 'username' : undefined;
          return { token: `${window.__duetNonce}:${token}`, kind };
        });
        return { ...(await where(page)), ...binding };
      });
    case 'fill-input':
      return withPage(async (page) => {
        const token = String(args.token || '');
        if (page.url() !== String(args.url || page.url()) || !token.includes(':')) throw new Error('The page changed while waiting for input.');
        const nonce = token.split(':', 1)[0];
        if (await page.evaluate((n) => window.__duetNonce === n, nonce) === false) throw new Error('The page changed while waiting for input.');
        const fieldToken = token.slice(token.indexOf(':') + 1);
        const field = page.locator(`[data-duet-input-token="${fieldToken}"]`).first();
        const handle = await field.elementHandle();
        if (!handle || await field.count() !== 1) throw new Error('The page changed while waiting for input.');
        const original = await handle.evaluate((node, token) => {
          const binding = window.__duetBindings?.get(token);
          return binding?.node === node && binding.signature === [node.tagName, node.getAttribute('name'), node.getAttribute('type'), node.getAttribute('autocomplete')].join('|');
        }, fieldToken);
        if (!original) throw new Error('The field changed while waiting for input.');
        try { await handle.fill(String(args.text), { timeout: 10_000 }); }
        catch { throw new Error('Credential field could not be filled. Inspect the page and request fresh input.'); }
        await page.evaluate((token) => window.__duetBindings?.delete(token), fieldToken);
        await handle.evaluate((node) => node.setAttribute('data-duet-sensitive', 'true'));
        if (args.submit) await page.keyboard.press('Enter');
        return where(page);
      });
    case 'press':
      return withPage(async (page) => {
        await page.keyboard.press(String(args.key));
        return where(page);
      });
    case 'cookies': {
      // Import sign-in cookies into the persistent Chromium profile (from the Mac/PC browser).
      const list = Array.isArray(args.cookies) ? args.cookies : [];
      if (!list.length) throw new Error('No cookies to import.');
      if (!(await up())) await start();
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      try {
        const context = browser.contexts()[0] ?? (await browser.newContext());
        // Playwright cookie shape; drop anything incomplete.
        const clean = list
          .filter((c) => c && typeof c.name === 'string' && typeof c.value === 'string' && typeof c.domain === 'string')
          .map((c) => ({
            name: String(c.name).slice(0, 200),
            value: String(c.value).slice(0, 10_000),
            domain: String(c.domain).slice(0, 200),
            path: typeof c.path === 'string' && c.path ? c.path : '/',
            expires: typeof c.expires === 'number' ? c.expires : -1,
            httpOnly: Boolean(c.httpOnly),
            secure: Boolean(c.secure),
            sameSite: c.sameSite === 'Strict' || c.sameSite === 'Lax' || c.sameSite === 'None' ? c.sameSite : 'Lax',
          }));
        for (let i = 0; i < clean.length; i += 200) {
          await context.addCookies(clean.slice(i, i + 200));
        }
        await pin(context).catch(() => {});
        return { status: `imported ${clean.length} cookies`, count: clean.length };
      } finally {
        await browser.close();
      }
    }
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
