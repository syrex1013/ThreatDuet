import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let remote: typeof import('./remote.js');

beforeAll(async () => {
  // config.ts reads these at import time, so set them before loading any server module.
  process.env.THREATDUET_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'threatduet-test-'));
  process.env.THREATDUET_REMOTE_PORT = '0';
  await (await import('./store.js')).openStore();
  remote = await import('./remote.js');
});

afterAll(async () => {
  await remote.setRemote({ enabled: false });
});

const get = (p: string, token?: string) =>
  remote.remoteApp.request(p, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe('phone access', () => {
  it('compares tokens safely', () => {
    expect(remote.tokenMatches('', null)).toBe(false);
    expect(remote.tokenMatches('abc', 'abc')).toBe(true);
    expect(remote.tokenMatches('abd', 'abc')).toBe(false);
    expect(remote.tokenMatches('', 'abc')).toBe(false);
  });

  it('recognises Tailscale addresses', () => {
    expect(remote.isTailscale('100.77.213.17')).toBe(true);
    expect(remote.isTailscale('100.128.0.1')).toBe(false);
    expect(remote.isTailscale('192.168.1.20')).toBe(false);
  });

  it('refuses everything while phone access is off', async () => {
    expect((await get('/api/state')).status).toBe(401);
  });

  it('answers only requests with the current token', async () => {
    const info = await remote.setRemote({ enabled: true });
    if ('error' in info) throw new Error(info.error);
    const token = info.token!;
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect((await get('/api/state', token)).status).toBe(200);
    expect((await get('/api/state', `${token}x`)).status).toBe(401);
    expect((await get('/api/state')).status).toBe(401);
    // Pairing is managed from the computer only.
    expect((await get('/api/remote', token)).status).toBe(404);

    const rotated = await remote.setRemote({ rotate: true });
    if ('error' in rotated) throw new Error(rotated.error);
    expect((await get('/api/state', token)).status).toBe(401);
    expect((await get('/api/state', rotated.token!)).status).toBe(200);
  });
});
