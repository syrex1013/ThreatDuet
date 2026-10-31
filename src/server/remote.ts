import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import { Hono } from 'hono';
import type { ServerType } from '@hono/node-server';
import type { RemoteAddress, RemoteInfo } from '../shared/types.js';
import { api } from './api.js';
import { log } from './config.js';
import { closeServer, listen } from './listen.js';
import { db } from './store.js';

const sha = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time token check (hashing first makes the lengths equal). */
export function tokenMatches(given: string, expected: string | null): boolean {
  return Boolean(expected) && given.length > 0 && timingSafeEqual(sha(given), sha(expected!));
}

/** Tailscale hands out addresses from the CGNAT range 100.64.0.0/10. */
export function isTailscale(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

export function networkAddresses(): RemoteAddress[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => ({ address: i!.address, kind: isTailscale(i!.address) ? ('tailscale' as const) : ('lan' as const) }))
    .sort((a, b) => Number(b.kind === 'tailscale') - Number(a.kind === 'tailscale'));
}

/** The phone listener: same API as the local app, but every request must carry the pairing token. */
export const remoteApp = new Hono<{ Variables: { phone?: boolean } }>();
remoteApp.use('*', async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!db.data.remote.enabled || !tokenMatches(given, db.data.remote.token)) {
    log.info({ method: c.req.method, path: c.req.path, status: 401 }, 'phone request refused');
    return c.json({ error: 'This phone is not paired. Pair it again from OpenDuet on your computer.' }, 401);
  }
  c.set('phone', true);
  await next();
  log.info({ method: c.req.method, path: c.req.path, status: c.res.status }, 'phone request');
});
remoteApp.route('/api', api);

let server: ServerType | null = null;

/** Opens or closes the phone listener to match the saved setting. */
export async function syncRemote(): Promise<void> {
  const r = db.data.remote;
  if (r.enabled && !server) {
    server = (await listen(remoteApp.fetch, '0.0.0.0', r.port)).server;
    log.info({ port: r.port }, 'phone access on');
  } else if (!r.enabled && server) {
    await closeServer(server);
    server = null;
    log.info('phone access off');
  }
}

export async function stopRemote(): Promise<void> {
  if (server) await closeServer(server);
  server = null;
}

export function remoteInfo(): RemoteInfo {
  const r = db.data.remote;
  return { enabled: r.enabled, port: r.port, token: r.enabled ? r.token : null, addresses: networkAddresses() };
}

/** Turns phone access on or off. `rotate` issues a new token, which unpairs every phone. */
export async function setRemote({ enabled, rotate }: { enabled?: boolean; rotate?: boolean }): Promise<RemoteInfo | { error: string }> {
  const r = db.data.remote;
  if (rotate || (enabled && !r.token)) r.token = randomBytes(32).toString('base64url');
  if (enabled !== undefined) r.enabled = enabled;
  try {
    await syncRemote();
  } catch (err) {
    r.enabled = false;
    await db.write();
    return { error: `Couldn't open port ${r.port} for your phone: ${(err as Error).message}` };
  }
  await db.write();
  return remoteInfo();
}
