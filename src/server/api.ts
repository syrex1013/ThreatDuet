import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { StateResponse } from '../shared/types.js';
import { WORKSPACE } from './config.js';
import { approve, cancelFollowup, chat, currentDetail, currentWork, reject, routines } from './duet.js';
import { computerBrief } from './computer/machine.js';
import { onStateChange, stateVersion } from './events.js';
import { upcomingRoutines } from './scheduler.js';
import { db, post, readMemory, writeMemory, writeWorkspaceConfig } from './store.js';

const time = z.string().regex(/^\d{2}:\d{2}$/);
const SettingsPatch = z
  .object({
    model: z.string().min(1),
    briefAt: time,
    reportAt: time,
    checkEveryHours: z.coerce.number().min(0).max(168),
    quietStart: time,
    quietEnd: time,
    focus: z.string().max(2000),
    openWebPages: z.boolean(),
    memory: z.string().max(200_000),
  })
  .partial();
const Id = z.object({ id: z.string().uuid() });

export const json = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) return c.json({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  });

/** Everything the UI needs. Mounted by the local app and, behind a token, by the phone listener. */
export const api = new Hono<{ Variables: { phone?: boolean } }>()
  .get('/state', async (c) => {
    const body: StateResponse = {
      settings: db.data.settings,
      messages: db.data.messages.slice(-200),
      busy: currentWork(),
      busyDetail: currentDetail(),
      computer: computerBrief(),
      version: stateVersion(),
      followups: [...db.data.followups].sort((a, b) => a.at - b.at),
      upcoming: upcomingRoutines(),
      digestCount: db.data.digest.length,
      memory: await readMemory(),
    };
    return c.json(body);
  })
  // Live updates: a change event whenever state moves, so clients refetch instead of polling.
  .get('/events', (c) =>
    streamSSE(c, async (stream) => {
      let open = true;
      stream.onAbort(() => {
        open = false;
      });
      const send = (version: number) => stream.writeSSE({ event: 'change', data: String(version) }).catch(() => {});
      const stop = onStateChange(send);
      await send(stateVersion());
      try {
        while (open) {
          await stream.sleep(20_000);
          if (open) await stream.writeSSE({ event: 'ping', data: '' });
        }
      } finally {
        stop();
      }
    }),
  )
  // Read-only view of what Duet prepared in its workspace. realpath defeats symlinks out of it.
  .get('/file', async (c) => {
    const root = await fs.realpath(WORKSPACE);
    const abs = await fs.realpath(path.resolve(root, c.req.query('path') ?? '')).catch(() => null);
    if (!abs) return c.json({ error: 'That file no longer exists.' }, 404);
    const rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep)[0] === '.git')
      return c.json({ error: 'Only files in the workspace can be opened.' }, 400);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return c.json({ error: 'That is a folder, not a file.' }, 400);
    if (stat.size > 1_000_000) return c.json({ error: 'The file is larger than 1 MB. Open it from the workspace folder.' }, 413);
    return c.json({ path: rel, text: await fs.readFile(abs, 'utf8') });
  })
  .post('/message', json(z.object({ text: z.string().trim().min(1).max(20_000) })), async (c) => {
    await chat(c.req.valid('json').text);
    return c.json({ ok: true });
  })
  .post('/approve', json(Id), async (c) => {
    const r = await approve(c.req.valid('json').id, Boolean(c.get('phone')));
    return 'error' in r ? c.json({ error: r.error }, r.status) : c.json(r);
  })
  .post('/reject', json(Id), async (c) =>
    (await reject(c.req.valid('json').id)) ? c.json({ ok: true }) : c.json({ error: 'not pending' }, 409),
  )
  .post('/followups/cancel', json(Id), async (c) =>
    (await cancelFollowup(c.req.valid('json').id)) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404),
  )
  .post('/run', json(z.object({ kind: z.enum(['brief', 'check', 'report']) })), (c) => {
    routines[c.req.valid('json').kind]();
    return c.json({ ok: true });
  })
  .post('/settings', json(SettingsPatch), async (c) => {
    const { memory, ...settings } = c.req.valid('json');
    Object.assign(db.data.settings, settings);
    if (memory !== undefined) await writeMemory(memory);
    await db.write();
    await writeWorkspaceConfig();
    return c.json({ ok: true });
  })
  .post('/new-thread', async (c) => {
    db.data.threadSession = null;
    await post({ role: 'system', kind: 'info', text: 'Started a fresh thread context.' });
    return c.json({ ok: true });
  });
