import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const home = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const root = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/duet-browser-acceptance-`);
  process.env.THREATDUET_HOME = root;
  return root;
});
const store = await import('./store.js');
const browser = await import('./mac/browser.js');
// Firefox can't be driven directly; every installed Chromium browser must keep its sessions.
const installed = (await browser.browserChoices()).filter((b) => b.installed && b.id !== 'firefox').map((b) => b.id);
let server: http.Server;
let origin: string;
beforeAll(async () => {
  await store.openStore();
  store.db.data.mac.browser = true;
  server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html');
    if (request.url?.includes('seed=1')) response.setHeader('Set-Cookie', 'private_session=retained; Path=/; SameSite=Lax');
    response.end(`<title>Private login fixture</title><p>Fixture</p><input type="password" name="password" value="do-not-leak-fixture"><textarea>textarea-private-fixture</textarea><div contenteditable="true">editable-private-fixture</div><button onclick="const e=document.querySelector('input');e.replaceWith(e.cloneNode(true))">Clone field</button><button onclick="document.activeElement.blur()">Blur</button><p id="storage"></p><script>if(location.search.includes('seed=1'))localStorage.setItem('private_storage','retained');document.querySelector('#storage').textContent=localStorage.getItem('private_storage')||'empty';</script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await browser.stopBrowser(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

describe.each(installed)('private persistent browser (%s)', (id) => {
  beforeAll(async () => {
    await browser.stopBrowser();
    store.db.data.mac.browserApp = id;
    // Seed a fresh private profile; never import the user's actual browser credentials into this test.
    await fs.mkdir(path.join(home, `data/browser-profiles/${id}/Default`), { recursive: true });
    await fs.writeFile(path.join(home, `data/browser-profiles/${id}/Default/Preferences`), '{}');
  });
  afterAll(() => browser.stopBrowser());
  it('redacts fallback values and rejects cloned fields and reloaded documents', async () => {
    await browser.browse('open', { url: `${origin}/?seed=1` });
    const page = await browser.browse('read');
    expect(JSON.stringify(page)).not.toMatch(/do-not-leak-fixture|textarea-private-fixture|editable-private-fixture/);
    const field = page.elements!.find((element) => element.kind === 'input:password')!;
    const clone = page.elements!.find((element) => element.label === 'Clone field')!;
    const binding = await browser.browse('inspect-input', { ref: field.ref });
    await browser.browse('click', { ref: clone.ref });
    await expect(browser.browse('fill-input', { token: binding.token, url: binding.url, text: 'secret-to-original' })).rejects.toThrow(/field changed/);
    const next = await browser.browse('read');
    const fresh = await browser.browse('inspect-input', { ref: next.elements!.find((element) => element.kind === 'input:password')!.ref });
    await browser.browse('open', { url: `${origin}/?seed=1` });
    await expect(browser.browse('fill-input', { token: fresh.token, url: fresh.url, text: 'secret-to-original' })).rejects.toThrow(/page changed/);
  }, 30_000);
  it('preserves cookies and local storage across browser close and visible takeover', async () => {
    await browser.stopBrowser();
    expect(await fs.stat(path.join(home, `data/browser-profiles/${id}/Default`))).toBeDefined();
    await browser.browse('open', { url: `${origin}/` });
    expect((await browser.browse('read')).text).toContain('retained');
    expect(await browser.exportCookies(origin)).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'private_session', value: 'retained' })]));
    await browser.takeoverBrowser();
    expect(browser.browserInteractive()).toBe(true);
    await expect(browser.browse('read')).rejects.toThrow(/Automation is paused/);
    expect((await browser.browse('read', { manual: true })).title).toBe('Private login fixture');
    await browser.finishTakeover();
    await browser.browse('open', { url: origin });
    expect((await browser.browse('read')).text).toContain('retained');
  }, 30_000);
});
