import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { StateResponse } from '../shared/types.js';
import { WORKSPACE } from './config.js';
import { approve, cancelFollowup, chat, completeTask, currentDetail, currentWork, deleteRoutine, dismissTask, kickoff, openRecs, reject, routines, setRoutine, startTask } from './duet.js';
import { cancelInput, openInput, respondInput } from './input.js';
import { computerBrief } from './computer/machine.js';
import { SKIP } from './direct/tools.js';
import { OS_ID } from './mac/os.js';
import { onStateChange, stateChanged, stateVersion } from './events.js';
import { nextRoutineRun } from './parse.js';
import { routineDue, upcomingRoutines } from './scheduler.js';
import { appendMemory, db, post, PROTECTED, readMemory, writeMemory, writeWorkspaceConfig } from './store.js';
import { tr } from './i18n.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const SettingsPatch = z
  .object({
    model: z.string().min(1),
    briefAt: time,
    reportAt: time,
    checkEveryHours: z.coerce.number().min(0).max(168),
    quietStart: time,
    quietEnd: time,
    focus: z.string().max(2000),
    kiloMode: z.enum(['api', 'cli', 'direct']),
    language: z.enum(['en', 'pl']),
    memory: z.string().max(200_000),
  })
  .partial();
const Id = z.object({ id: z.string().uuid() });
const ChannelRef = z.object({ channel: z.string().min(1).optional() });
const hasChannel = (id?: string) => !id || db.data.channels.some((ch) => ch.id === id);

/** The newest messages of each channel, oldest first. */
function recent(perChannel: number) {
  const seen = new Map<string | undefined, number>();
  return [...db.data.messages]
    .reverse()
    .filter((m) => {
      const n = (seen.get(m.channel) ?? 0) + 1;
      seen.set(m.channel, n);
      return n <= perChannel;
    })
    .reverse();
}

export const json = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) return c.json({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  });

/** Everything the UI needs. Mounted by the local app and, behind a token, by the phone listener. */
export const api = new Hono<{ Variables: { phone?: boolean } }>()
  .get('/state', async (c) => {
    const body: StateResponse = {
      settings: db.data.settings,
      messages: recent(200),
      busy: currentWork(),
      busyDetail: currentDetail(),
      computer: computerBrief(),
      version: stateVersion(),
      followups: [...db.data.followups].sort((a, b) => a.at - b.at),
      upcoming: upcomingRoutines(),
      routines: db.data.routines.map((r) => ({ ...r, nextAt: r.enabled ? routineDue(r) : nextRoutineRun(r.cron) })),
      digestCount: db.data.digest.length,
      memory: await readMemory(),
      channels: db.data.channels.map(({ id, name }) => ({ id, name })),
      tasks: db.data.tasks.slice(0, 40),
      setupDone: db.data.setupDone,
      os: OS_ID,
      recs: openRecs(),
      pendingInput: openInput(),
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
    if (!abs) return c.json({ error: tr('That file no longer exists.') }, 404);
    const rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep)[0] === '.git')
      return c.json({ error: tr('Only files in the workspace can be opened.') }, 400);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return c.json({ error: tr('That is a folder, not a file.') }, 400);
    if (stat.size > 1_000_000) return c.json({ error: tr('The file is larger than 1 MB. Open it from the workspace folder.') }, 413);
    return c.json({ path: rel, text: await fs.readFile(abs, 'utf8') });
  })
  // Everything Duet made, newest first. Same confinement as /file: symlinks and Kilo's own config are never listed.
  .get('/files', async (c) => {
    const root = await fs.realpath(WORKSPACE);
    const files: { path: string; size: number; mtime: number }[] = [];
    const walk = async (dir: string): Promise<void> => {
      // An unreadable folder or a file deleted mid-walk is skipped, not a failed listing.
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.isSymbolicLink() || SKIP.has(e.name) || (dir === root && PROTECTED.includes(e.name))) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) await walk(abs);
        else if (e.isFile()) {
          const s = await fs.stat(abs).catch(() => null);
          if (s) files.push({ path: path.relative(root, abs).split(path.sep).join('/'), size: s.size, mtime: s.mtimeMs });
        }
      }
    };
    await walk(root);
    return c.json({ files: files.sort((a, b) => b.mtime - a.mtime).slice(0, 300) });
  })
  .post('/message', json(ChannelRef.extend({ text: z.string().trim().min(1).max(20_000) })), async (c) => {
    const { text, channel } = c.req.valid('json');
    if (!hasChannel(channel)) return c.json({ error: tr('That channel no longer exists.') }, 400);
    await chat(text, channel);
    return c.json({ ok: true });
  })
  .post('/channels', json(z.object({ name: z.string().trim().min(1).max(40) })), async (c) => {
    const id = randomUUID();
    db.data.channels.push({ id, name: c.req.valid('json').name, session: null, createdAt: Date.now() });
    await db.write();
    return c.json({ ok: true, id });
  })
  // Nothing is lost: the channel's history moves to the main thread.
  .post('/channels/delete', json(Id), async (c) => {
    const { id } = c.req.valid('json');
    if (!hasChannel(id)) return c.json({ error: tr('not found') }, 404);
    db.data.channels = db.data.channels.filter((ch) => ch.id !== id);
    for (const m of db.data.messages) if (m.channel === id) delete m.channel;
    await db.write();
    return c.json({ ok: true });
  })
  .post('/approve', json(Id), async (c) => {
    const r = await approve(c.req.valid('json').id, Boolean(c.get('phone')));
    return 'error' in r ? c.json({ error: r.error }, r.status) : c.json(r);
  })
  .post('/reject', json(Id), async (c) =>
    (await reject(c.req.valid('json').id)) ? c.json({ ok: true }) : c.json({ error: tr('not pending') }, 409),
  )
  .post('/followups/cancel', json(Id), async (c) =>
    (await cancelFollowup(c.req.valid('json').id)) ? c.json({ ok: true }) : c.json({ error: tr('not found') }, 404),
  )
  .post('/routines/toggle', json(Id.extend({ enabled: z.boolean() })), async (c) => {
    const { id, enabled } = c.req.valid('json');
    // A routine runs unattended turns forever; only someone at this computer may start one.
    if (enabled && c.get('phone')) return c.json({ error: tr('Routines can only be turned on on this computer.') }, 403);
    return (await setRoutine(id, enabled)) ? c.json({ ok: true }) : c.json({ error: tr('not found') }, 404);
  })
  .post('/tasks/start', json(Id), async (c) =>
    (await startTask(c.req.valid('json').id)) ? c.json({ ok: true }) : c.json({ error: tr('That task is no longer waiting.') }, 409),
  )
  .post('/recs/seen', async (c) => {
    db.data.recs.seenAt = Date.now();
    await db.write();
    stateChanged();
    return c.json({ ok: true });
  })
  .post('/tasks/dismiss', json(Id), async (c) =>
    (await dismissTask(c.req.valid('json').id)) ? c.json({ ok: true }) : c.json({ error: tr('That task is no longer waiting.') }, 409),
  )
  .post('/tasks/done', json(Id), async (c) =>
    (await completeTask(c.req.valid('json').id)) ? c.json({ ok: true }) : c.json({ error: tr('That task is no longer waiting.') }, 409),
  )

  .post('/setup', json(SettingsPatch.omit({ memory: true, kiloMode: true, model: true }).extend({ name: z.string().trim().max(200).optional(), about: z.string().trim().max(4000).optional(), skip: z.boolean().optional() })), async (c) => {
    // First-launch setup belongs to whoever sits at this computer, not to a paired phone.
    if (c.get('phone')) return c.json({ error: tr('Finish setup on your computer.') }, 403);
    if (db.data.setupDone) return c.json({ error: tr('Setup is already done.') }, 409);
    const { name, about, skip, ...settings } = c.req.valid('json');
    Object.assign(db.data.settings, settings);
    const facts = [name && `The user's name is ${name}.`, about && `About the user and their work: ${about}`].filter(Boolean) as string[];
    if (facts.length) await appendMemory(facts);
    db.data.setupDone = true;
    // Duet's introduction stands in for today's brief; the first scheduled one comes tomorrow.
    if (!skip) db.data.lastBrief = new Date().toLocaleDateString('sv');
    await db.write();
    await writeWorkspaceConfig();
    if (!skip) kickoff();
    return c.json({ ok: true });
  })
  .post('/routines/delete', json(Id), async (c) =>
    (await deleteRoutine(c.req.valid('json').id)) ? c.json({ ok: true }) : c.json({ error: tr('not found') }, 404),
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
  
  .post('/input', json(Id.extend({ value: z.string().min(1).max(5000) })), async (c) => {
    const { id, value } = c.req.valid('json');
    return respondInput(id, value) ? c.json({ ok: true }) : c.json({ error: tr('That prompt is no longer open.') }, 409);
  })
  .post('/input/cancel', json(Id), async (c) =>
    cancelInput(c.req.valid('json').id) ? c.json({ ok: true }) : c.json({ error: tr('That prompt is no longer open.') }, 409),
  )
  .post('/new-thread', json(ChannelRef), async (c) => {
    const { channel } = c.req.valid('json');
    const ch = db.data.channels.find((x) => x.id === channel);
    if (channel && !ch) return c.json({ error: tr('That channel no longer exists.') }, 400);
    if (ch) ch.session = null;
    else db.data.threadSession = null;
    await post({ role: 'system', kind: 'info', text: tr('Started a fresh thread context.'), channel });
    return c.json({ ok: true });
  });
