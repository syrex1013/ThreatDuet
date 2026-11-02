import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { Registry, adminTokenMatches, type Tenant } from './registry.js';

export interface Sandbox {
  preflight(tenant: Tenant): Promise<{ available: boolean; reason: string | null }>;
  execute(tenant: Tenant, operation: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

/** One global execution slot. Queue entries retain authenticated tenant identity, never a body-supplied ID. */
export function buildBroker(registry: Registry, sandbox: Sandbox, adminToken: string) {
  const app = new Hono<{ Variables: { tenant: Tenant } }>();
  let tail = Promise.resolve();
  let queued = 0;
  let active: string | null = null;
  const queue: string[] = [];
  const interactive = new Set<string>();
  app.use('*', bodyLimit({ maxSize: 1_048_576 }));
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.method !== 'GET' && !c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: 'JSON required.' }, 415);
    if (c.req.path.startsWith('/admin/')) {
      if (!adminTokenMatches(c.req.header('authorization'), adminToken)) return c.json({ error: 'Unauthorized.' }, 401);
    } else if (c.req.path !== '/enroll') {
      const tenant = registry.authenticate(c.req.header('authorization')?.replace(/^Bearer /, '') ?? '');
      if (!tenant) return c.json({ error: 'Invalid or revoked installation token.' }, 401);
      c.set('tenant', tenant);
    }
    await next();
  });
  app.onError((_, c) => c.json({ error: 'Broker operation failed. Review administrator diagnostics.' }, 500));
  const enrollment = z.object({ code: z.string().min(20).max(200), installationId: z.uuid(), name: z.string().trim().min(1).max(80) }).strict();
  app.post('/enroll', async (c) => {
    const input = enrollment.safeParse(await c.req.json());
    if (!input.success) return c.json({ error: 'Invalid enrollment.' }, 400);
    try { return c.json(await registry.enroll(input.data.code, input.data.installationId, input.data.name)); }
    catch { return c.json({ error: 'Invite is invalid, expired, or already used.' }, 409); }
  });
  app.post('/admin/invites', async (c) => {
    if (!registry.migrationReady()) return c.json({ error: 'Administrator migration has not been verified.' }, 409);
    return c.json(await registry.invite());
  });
  app.get('/admin/installations', (c) => c.json(registry.installations()));
  app.post('/admin/revoke', async (c) => {
    const input = z.object({ installationId: z.uuid() }).strict().safeParse(await c.req.json());
    if (!input.success) return c.json({ error: 'Invalid installation.' }, 400);
    await registry.revoke(input.data.installationId);
    return c.json({ ok: true });
  });
  app.get('/status', async (c) => {
    const tenant = c.get('tenant');
    return c.json({ tenant: { id: tenant.id, name: tenant.name }, ...(await sandbox.preflight(tenant)), browserMode: interactive.has(tenant.id) ? 'interactive' : 'automatic', execution: active === tenant.id ? 'acting' : queue.includes(tenant.id) ? 'queued' : 'idle', queuePosition: queue.indexOf(tenant.id) + 1 });
  });
  const operation = z.object({ operation: z.enum(['browser', 'readFile', 'writeFile', 'exec', 'copyFile', 'takeover']), arguments: z.record(z.string(), z.unknown()), manual: z.boolean().optional() }).strict();
  app.post('/operation', async (c) => {
    const input = operation.safeParse(await c.req.json());
    if (!input.success) return c.json({ error: 'Invalid operation. Tenant selection is never accepted.' }, 400);
    const tenant = c.get('tenant');
    const check = await sandbox.preflight(tenant);
    if (!check.available) return c.json({ error: check.reason }, 503);
    if (queued >= 32) return c.json({ error: 'Cloud execution queue is full.' }, 429);
    queued++;
    queue.push(tenant.id);
    let release!: () => void;
    const previous = tail;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    queued--;
    queue.splice(queue.indexOf(tenant.id), 1);
    active = tenant.id;
    try {
      if (!registry.authenticate(c.req.header('authorization')?.replace(/^Bearer /, '') ?? '')) return c.json({ error: 'Installation revoked while queued.' }, 401);
      if (c.req.raw.signal.aborted) return c.json({ error: 'Request cancelled before execution.' }, 409);
      if (input.data.operation === 'takeover') {
        const mode = z.object({ enabled: z.boolean() }).strict().safeParse(input.data.arguments);
        if (!mode.success) return c.json({ error: 'Invalid takeover mode.' }, 400);
        if (mode.data.enabled) interactive.add(tenant.id); else interactive.delete(tenant.id);
        return c.json({ result: { browserMode: mode.data.enabled ? 'interactive' : 'automatic' } });
      }
      if (interactive.has(tenant.id) && !input.data.manual) return c.json({ error: 'Private browser takeover active. Automation paused until user returns control.' }, 409);
      // Never retry mutations: a disconnect after execution leaves an uncertain outcome for the caller.
      return c.json({ result: await sandbox.execute(tenant, input.data.operation, input.data.arguments, c.req.raw.signal) });
    } catch { return c.json({ error: 'Cloud operation failed; outcome may be uncertain. Inspect before retrying.' }, 409); }
    finally { active = null; release(); }
  });
  return app;
}
