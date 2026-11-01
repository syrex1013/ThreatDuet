import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { previewDoc } from './previewDoc';

// previewDoc relies on the browser's HTML parser, which Node lacks, so it runs in installed Chrome.
let browser: Browser | null = null;
beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome' }).catch(() => null);
}, 30_000);
afterAll(() => browser?.close());

const run = async (html: string): Promise<string> => {
  const page = await browser!.newPage();
  try {
    return await page.evaluate(([src, input]) => (0, eval)(`(${src})`)(input), [previewDoc.toString(), html]);
  } finally {
    await page.close();
  }
};

describe('previewDoc', () => {
  it('keeps the content but nothing that can navigate or load', async () => {
    expect(browser, 'Google Chrome must be installed for this test').not.toBeNull();
    const doc = await run(
      [
        '<h1 style="color:red">Dash</h1><p title="<link>">x</p>',
        '<a href="https://evil.example/?d=secret" target=_self>open</a>',
        '<meta http-equiv=refresh content="0;url=https://evil.example/">',
        '<LiNk rel=dns-prefetch href=//a.example.com><img src=https://evil.example/i.png onerror=x>',
        '<svg><a xlink:href="https://evil.example/"><text>t</text></a><set attributeName=href to=https://evil.example/ /><link/href=//b.example.com></svg>',
        '<form action=https://evil.example/><button formaction=https://evil.example/>go</button></form><area href=https://evil.example/>',
      ].join(''),
    );
    expect(doc.startsWith('<meta http-equiv="Content-Security-Policy" content="default-src \'none\';')).toBe(true);
    const body = doc.slice(doc.indexOf('>') + 1);
    expect(body).not.toMatch(/evil\.example|a\.example|b\.example|<link|<meta|<form|<set|onerror|href|src=/i);
    expect(body).toContain('<h1 style="color:red">Dash</h1>');
    expect(body).toContain('open</a>');
  }, 30_000);
});
