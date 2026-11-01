import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KiloResult } from './parse.js';

await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  process.env.OPENDUET_HOME = mkdtempSync(`${process.env.TMPDIR ?? '/tmp'}/openduet-sched-`);
});
vi.mock('./kilo.js', () => ({ runKilo: vi.fn() }));
vi.mock('./notify.js', () => ({ notify: vi.fn() }));

const { runKilo } = await import('./kilo.js');
const store = await import('./store.js');
const duet = await import('./duet.js');
const scheduler = await import('./scheduler.js');
const { api } = await import('./api.js');

const kilo = vi.mocked(runKilo);
const reply = (text: string): KiloResult => ({ sessionID: 's1', text, finalText: text, tools: [], errors: [] });
const routine = (enabled: boolean) => ({
  id: crypto.randomUUID(),
  what: 'refresh dashboard.html',
  cron: '0 0 1 1 *',
  enabled,
  createdAt: Date.now() - 2 * 365 * 86_400_000,
  lastRun: null,
});
const phone = new Hono<{ Variables: { phone?: boolean } }>()
  .use((c, next) => {
    c.set('phone', true);
    return next();
  })
  .route('/', api);
const call = (app: { request: Hono['request'] }, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  await store.openStore();
  store.db.data.setupDone = true;
});

beforeEach(() => {
  kilo.mockReset();
  kilo.mockResolvedValue(reply('NOTHING'));
  const today = new Date().toLocaleDateString('sv');
  Object.assign(store.db.data, { messages: [], followups: [], routines: [], digest: [], lastBrief: today, lastReport: today });
  store.db.data.settings.checkEveryHours = 0;
});

describe('routines', () => {
  it('runs a due routine once across ticks and records the run', async () => {
    const r = routine(true);
    store.db.data.routines.push(r);
    let release!: (v: KiloResult) => void;
    kilo.mockReturnValueOnce(new Promise((ok) => (release = ok)));
    await scheduler.tick();
    await scheduler.tick();
    await vi.waitFor(() => expect(kilo).toHaveBeenCalled());
    await scheduler.tick();
    release(reply('NOTHING'));
    await duet.idle();
    await scheduler.tick();
    await duet.idle();
    expect(kilo).toHaveBeenCalledTimes(1);
    expect(kilo.mock.calls[0][0].prompt).toContain('ROUTINE you run on a schedule (0 0 1 1 *): refresh dashboard.html');
    expect(store.db.data.routines[0].lastRun).toBeGreaterThan(r.createdAt);
  });

  it('never runs a disabled routine', async () => {
    store.db.data.routines.push(routine(false));
    await scheduler.tick();
    await duet.idle();
    expect(kilo).not.toHaveBeenCalled();
  });

  it('stores routines Duet suggests turned off', async () => {
    kilo.mockResolvedValue(reply('Done.\n<<ROUTINE: 30 5 * * 1-5 | rebuild dashboard.html>>'));
    await duet.chat('keep the dashboard fresh');
    await duet.chat('again');
    await duet.idle();
    expect(store.db.data.routines).toMatchObject([{ cron: '30 5 * * 1-5', what: 'rebuild dashboard.html', enabled: false, lastRun: null }]);
  });

  it('does not run a routine the moment it is turned on, only at its next slot', async () => {
    const r = routine(false);
    store.db.data.routines.push(r);
    expect((await call(api, '/routines/toggle', { id: r.id, enabled: true })).status).toBe(200);
    await scheduler.tick();
    await duet.idle();
    expect(kilo).not.toHaveBeenCalled();
    expect(scheduler.routineDue(store.db.data.routines[0])).toBeGreaterThan(Date.now());
  });

  it('lets only this computer turn a routine on', async () => {
    const r = routine(false);
    store.db.data.routines.push(r);
    expect((await call(phone, '/routines/toggle', { id: r.id, enabled: true })).status).toBe(403);
    expect(store.db.data.routines[0].enabled).toBe(false);
    expect((await call(api, '/routines/toggle', { id: r.id, enabled: true })).status).toBe(200);
    expect(store.db.data.routines[0].enabled).toBe(true);
    expect((await call(phone, '/routines/toggle', { id: r.id, enabled: false })).status).toBe(200);
    expect((await call(phone, '/routines/delete', { id: r.id })).status).toBe(200);
    expect(store.db.data.routines).toEqual([]);
  });
});
