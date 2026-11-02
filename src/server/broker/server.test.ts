import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { Registry } from './registry.js';
import { buildBroker, type Sandbox } from './server.js';

const json = (app: any, url: string, token: string, body?: unknown) => app.request(url, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
describe('broker isolation', () => it('binds tenant from token and rejects substitution, revocation, takeover automation', async () => {
  const dir = await mkdtemp('/tmp/duet-broker-'); const reg = new Registry(path.join(dir, 'r.json')); await reg.open(); const admin = await reg.bootstrap(); await reg.recordMigration('b', 's');
  const a = await reg.enroll((await reg.invite()).code, crypto.randomUUID(), 'A'); const b = await reg.enroll((await reg.invite()).code, crypto.randomUUID(), 'B');
  const seen: string[] = []; const sandbox: Sandbox = { preflight: async () => ({ available: true, reason: null }), execute: async (tenant, op) => { seen.push(`${tenant.name}:${op}`); return tenant.name; } };
  const app = buildBroker(reg, sandbox, admin.token);
  expect((await json(app, '/operation', a.token, { operation: 'readFile', arguments: { tenantId: b.tenant.id } })).status).toBe(200); expect(seen[0]).toBe('A:readFile');
  expect((await json(app, '/operation', a.token, { operation: 'takeover', arguments: { enabled: true } })).status).toBe(200);
  expect((await json(app, '/operation', a.token, { operation: 'readFile', arguments: {} })).status).toBe(409);
  await reg.revoke(reg.installations().find((x) => x.tenantId === a.tenant.id)!.installationId); expect((await json(app, '/status', a.token)).status).toBe(401);
  expect((await json(app, '/status', b.token)).status).toBe(200);
}));

it('serializes executions globally, exposes only own queue state, and rechecks revocation before dispatch', async () => {
  const dir = await mkdtemp('/tmp/duet-broker-queue-');
  const registry = new Registry(path.join(dir, 'registry.json')); await registry.open();
  const administrator = await registry.bootstrap(); await registry.recordMigration('backup', 'hash');
  const firstId = crypto.randomUUID(), secondId = crypto.randomUUID();
  const first = await registry.enroll((await registry.invite()).code, firstId, 'First');
  const second = await registry.enroll((await registry.invite()).code, secondId, 'Second');
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const executing = new Promise<void>((resolve) => { release = resolve; });
  const seen: string[] = [];
  const sandbox: Sandbox = { preflight: async () => ({ available: true, reason: null }), execute: async (tenant) => { seen.push(tenant.id); started(); await executing; return 'complete'; } };
  const app = buildBroker(registry, sandbox, administrator.token);
  const one = json(app, '/operation', first.token, { operation: 'exec', arguments: { cmd: 'one' } });
  await entered;
  const two = json(app, '/operation', second.token, { operation: 'exec', arguments: { cmd: 'two' } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect((await (await json(app, '/status', second.token)).json()).execution).toBe('queued');
  const activeStatus = await (await json(app, '/status', first.token)).json();
  expect(activeStatus.execution).toBe('acting');
  expect(JSON.stringify(activeStatus)).not.toContain(second.tenant.id);
  await registry.revoke(secondId);
  release();
  expect((await one).status).toBe(200);
  expect((await two).status).toBe(401);
  expect(seen).toEqual([first.tenant.id]);
});

it('fails closed when isolation is unavailable and never replays uncertain operations', async () => {
  const dir = await mkdtemp('/tmp/duet-broker-failure-');
  const registry = new Registry(path.join(dir, 'registry.json')); await registry.open();
  const administrator = await registry.bootstrap();
  let attempts = 0;
  let available = false;
  const app = buildBroker(registry, { preflight: async () => ({ available, reason: 'gVisor unavailable' }), execute: async () => { attempts++; throw new Error('Response lost after external action.'); } }, administrator.token);
  expect((await json(app, '/operation', administrator.token, { operation: 'exec', arguments: { cmd: 'go' } })).status).toBe(503);
  expect(attempts).toBe(0);
  available = true;
  expect((await json(app, '/operation', administrator.token, { operation: 'exec', arguments: { cmd: 'go' } })).status).toBe(409);
  expect(attempts).toBe(1);
  expect((await json(app, '/operation', administrator.token, { operation: 'exec', arguments: {}, tenantId: 'another-user' })).status).toBe(400);
});
