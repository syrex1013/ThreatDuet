import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
  const fs = await import('node:fs');
  process.env.THREATDUET_HOME = fs.mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/duet-firefox-cookies-`);
});
const { firefoxCookies } = await import('./mac/browser.js');

const soon = Math.floor(Date.now() / 1000) + 3600;
type Row = { name: string; sameSite: number; secure?: number; expiry?: number; origin?: string };

function firefoxDir(rows: Row[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-ff-profile-'));
  fs.mkdirSync(path.join(dir, 'Profiles', 'x.default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'profiles.ini'), '[Profile0]\nName=default\nIsRelative=1\nPath=Profiles/x.default\nDefault=1\n');
  const db = new DatabaseSync(path.join(dir, 'Profiles', 'x.default', 'cookies.sqlite'));
  db.exec("CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT NOT NULL DEFAULT '')");
  const insert = db.prepare('INSERT INTO moz_cookies (name, value, host, path, expiry, isSecure, isHttpOnly, sameSite, originAttributes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of rows) insert.run(r.name, 'v', 'example.com', '/', r.expiry ?? soon * 1000, r.secure ?? 0, 0, r.sameSite, r.origin ?? '');
  db.close();
  return dir;
}

describe('Firefox sign-ins', () => {
  it('become cookies Chromium accepts, and nothing live is dropped', async () => {
    const dataDir = firefoxDir([
      { name: 'unset_insecure', sameSite: 256 },
      { name: 'unset_secure', sameSite: 256, secure: 1 },
      { name: 'none_secure', sameSite: 0, secure: 1 },
      { name: 'none_insecure', sameSite: 0 },
      { name: 'lax', sameSite: 1 },
      { name: 'strict', sameSite: 2 },
      { name: 'session', sameSite: 1, expiry: 0 },
      { name: 'expired', sameSite: 1, expiry: 1000 },
      { name: 'container', sameSite: 1, origin: '^userContextId=2' },
    ]);
    const got = Object.fromEntries((await firefoxCookies({ id: 'firefox', name: 'Firefox', family: 'firefox', exes: [], dataDir })).map((c) => [c.name, c]));
    expect(Object.keys(got).sort()).toEqual(['lax', 'none_insecure', 'none_secure', 'session', 'strict', 'unset_insecure', 'unset_secure']);
    expect(got.unset_insecure.sameSite).toBe('Lax');
    expect(got.unset_secure.sameSite).toBe('Lax');
    expect(got.none_secure.sameSite).toBe('None');
    expect(got.none_insecure.sameSite).toBe('Lax');
    expect(got.strict.sameSite).toBe('Strict');
    expect(got.session.expires).toBe(-1);
    expect(got.lax.expires).toBe(soon);
    for (const c of Object.values(got)) expect(c.sameSite === 'None' ? c.secure : true).toBe(true);
  });
});
