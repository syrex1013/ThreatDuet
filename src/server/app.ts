import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import { WEB_DIST } from './config.js';
import { api, json } from './api.js';
import { remoteInfo, setRemote } from './remote.js';
import { addConnector, cancelSignIn, connectorsResponse, removeConnector, startSignIn, updateConnector } from './connectors.js';
import { db, writeWorkspaceConfig } from './store.js';
import { tr } from './i18n.js';
import { browser, computerStatus, connectComputer, disconnectComputer, listChoices, retrySetup, screen } from './computer/machine.js';
import { handleComputerMcp, tokenOk } from './computer/mcp.js';
import { handleMacMcp } from './mac/mcp.js';
import { openPrivacySettings } from './mac/os.js';
import { addFolder, macStatus, removeFolder, resyncBrowser, setMac } from './mac/settings.js';
import { writeConnectorsConfig } from './connectors.js';
import { installMcp, searchMcp } from './market.js';
import { discoverMcp, findByKeys, importServers, parseMcpConfig } from './mcp-import.js';
import { installSkill, listSkills, previewSkill, removeSkill, updateSkill } from './skills.js';

/** The local app: the UI and API on 127.0.0.1, for this computer only. */
export const app = new Hono();

// DNS-rebinding and CSRF protection: only our own host, and a custom header on writes
// (a cross-site form cannot set one without a CORS preflight, which we never grant).
app.use('*', async (c, next) => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(c.req.header('host') ?? '')) return c.json({ error: 'bad host' }, 403);
  // Kilo can't send the UI's header; its endpoint is protected by a bearer token instead.
  if (c.req.path === '/mcp/computer' || c.req.path === '/mcp/mac') return tokenOk(c.req.header('authorization')) ? next() : c.json({ error: 'unauthorized' }, 401);
  if (c.req.method !== 'GET' && c.req.header('x-duet') !== '1') return c.json({ error: 'missing x-duet header' }, 403);
  await next();
});

// Pairing is managed from this computer only; the phone listener never mounts these routes.
app.get('/api/remote', (c) => c.json(remoteInfo()));
app.post('/api/remote', json(z.object({ enabled: z.boolean().optional(), rotate: z.boolean().optional() })), async (c) => {
  const r = await setRemote(c.req.valid('json'));
  return 'error' in r ? c.json(r, 409) : c.json(r);
});

// Connected apps are managed from this computer only: sign-in opens a browser here, and the
// records hold credentials. The phone listener never mounts these routes.
const AppId = z.object({ id: z.string().regex(/^[a-z0-9]{1,32}$/) });
app.get('/api/connectors', async (c) => c.json(await connectorsResponse(c.req.query('refresh') === '1')));
app.post(
  '/api/connectors',
  json(
    z.object({
      name: z.string().trim().min(1).max(60),
      url: z.string().trim().min(8).max(2000).optional(),
      command: z.array(z.string().max(500)).min(1).max(40).optional(),
      env: z.record(z.string().max(64), z.string().max(4000)).optional(),
      confirmed: z.boolean().optional(),
      presetId: z.string().max(40).nullable().optional(),
      header: z.object({ name: z.string().regex(/^[A-Za-z0-9-]{1,64}$/), value: z.string().min(1).max(4000) }).optional(),
    }),
  ),
  async (c) => {
    const r = await addConnector(c.req.valid('json'));
    if ('error' in r) return c.json(r, 400);
    return c.json(r);
  },
);
app.post('/api/connectors/update', json(AppId.extend({ enabled: z.boolean().optional(), autoRead: z.boolean().optional() })), async (c) => {
  const { id, ...patch } = c.req.valid('json');
  if (!(await updateConnector(id, patch))) return c.json({ error: tr('That app is not connected.') }, 404);
  await writeWorkspaceConfig();
  return c.json({ ok: true });
});
app.post('/api/connectors/remove', json(AppId), async (c) => {
  if (!(await removeConnector(c.req.valid('json').id))) return c.json({ error: tr('That app is not connected.') }, 404);
  await writeWorkspaceConfig();
  return c.json({ ok: true });
});
app.post('/api/connectors/sign-in', json(AppId), async (c) => {
  const r = await startSignIn(c.req.valid('json').id);
  return 'error' in r ? c.json(r, 409) : c.json(r);
});
app.post('/api/connectors/cancel-sign-in', (c) => {
  cancelSignIn();
  return c.json({ ok: true });
});
app.get('/api/connectors/discover', async (c) => c.json({ servers: await discoverMcp() }));
app.post('/api/connectors/import', json(z.object({ keys: z.array(z.string().max(200)).max(50).optional(), text: z.string().max(200_000).optional(), confirmed: z.boolean() })), async (c) => {
  const { keys, text, confirmed } = c.req.valid('json');
  const list = [...(keys ? await findByKeys(keys) : []), ...(text ? parseMcpConfig(text) : [])];
  if (!list.length) return c.json({ error: tr('No servers found to import.') }, 400);
  const r = await importServers(list, confirmed);
  await writeWorkspaceConfig();
  return r.added || !r.errors.length ? c.json(r) : c.json({ error: r.errors[0] }, 400);
});
app.post('/api/connectors/web', json(z.object({ openWebPages: z.boolean() })), async (c) => {
  db.data.settings.openWebPages = c.req.valid('json').openWebPages;
  await db.write();
  await writeWorkspaceConfig();
  return c.json({ ok: true });
});

// Marketplace. Servers come from the official MCP Registry; the install route looks the entry up again,
// so the browser never supplies a command. Skills come from the bundled list or any GitHub link.
app.get('/api/market/mcp', async (c) => {
  try {
    return c.json(await searchMcp(c.req.query('q') ?? '', c.req.query('cursor') || undefined));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});
app.post('/api/market/mcp/install', json(z.object({ name: z.string().min(3).max(200), values: z.record(z.string().max(100), z.string().max(4000)).default({}), confirmed: z.boolean() })), async (c) => {
  const r = await installMcp(c.req.valid('json'));
  if ('error' in r) return c.json(r, 400);
  await writeWorkspaceConfig();
  return c.json(r);
});
const SkillSource = z.object({ url: z.string().max(500).optional(), text: z.string().max(1_000_000).optional() }).refine((v) => (v.url === undefined) !== (v.text === undefined), 'Give a link or the text.');
app.get('/api/skills', (c) => c.json({ skills: listSkills() }));
app.post('/api/skills/preview', json(SkillSource), async (c) => {
  const r = await previewSkill(c.req.valid('json'));
  return 'error' in r ? c.json(r, 400) : c.json(r);
});
app.post('/api/skills/install', json(SkillSource), async (c) => {
  const r = await installSkill(c.req.valid('json'));
  if ('error' in r) return c.json(r, 400);
  await writeWorkspaceConfig();
  return c.json(r);
});
const SkillName = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/) });
app.post('/api/skills/update', json(SkillName.extend({ enabled: z.boolean() })), async (c) => {
  const { name, enabled } = c.req.valid('json');
  if (!(await updateSkill(name, enabled))) return c.json({ error: tr('That skill is not installed.') }, 404);
  await writeWorkspaceConfig();
  return c.json({ ok: true });
});
app.post('/api/skills/remove', json(SkillName), async (c) => {
  if (!(await removeSkill(c.req.valid('json').name))) return c.json({ error: tr('That skill is not installed.') }, 404);
  await writeWorkspaceConfig();
  return c.json({ ok: true });
});

// This Mac: files, commands and Brave. Managed from this computer only; the phone listener never mounts it.
app.all('/mcp/mac', (c) => handleMacMcp(c.req.raw));
app.get('/api/mac', async (c) => c.json(await macStatus()));
app.post('/api/mac', json(z.object({ files: z.boolean().optional(), everything: z.boolean().optional(), shell: z.boolean().optional(), browser: z.boolean().optional(), browserApp: z.enum(['auto', 'brave', 'chrome', 'firefox']).optional(), auto: z.boolean().optional() })), async (c) => {
  await setMac(c.req.valid('json'));
  return c.json(await macStatus());
});
app.post('/api/mac/folders', json(z.object({ path: z.string().min(1).max(1000) })), async (c) => {
  const r = await addFolder(c.req.valid('json').path);
  return 'error' in r ? c.json(r, 400) : c.json(await macStatus());
});
app.post('/api/mac/folders/remove', json(z.object({ path: z.string().min(1).max(1000) })), async (c) => {
  await removeFolder(c.req.valid('json').path);
  return c.json(await macStatus());
});
app.post('/api/mac/browser/refresh', async (c) => {
  await resyncBrowser();
  return c.json(await macStatus());
});
// macOS: the System Settings page for Full Disk Access. The grant itself is the user's click there.
app.post('/api/mac/privacy', async (c) => {
  await openPrivacySettings();
  return c.json(await macStatus());
});

// Duet's cloud computer. Like apps, it is managed from this computer only.
app.all('/mcp/computer', (c) => handleComputerMcp(c.req.raw));
app.get('/api/computer', async (c) => c.json(await computerStatus()));
app.post('/api/computer/machines', json(z.object({ apiKey: z.string().trim().min(8).max(500).optional() })), async (c) => {
  try {
    return c.json({ machines: await listChoices(c.req.valid('json').apiKey) });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});
app.post('/api/computer/connect', json(z.object({ apiKey: z.string().trim().min(8).max(500).optional(), machineId: z.string().min(1).max(100) })), async (c) => {
  const r = await connectComputer(c.req.valid('json'));
  if ('error' in r) return c.json(r, 400);
  await writeConnectorsConfig();
  await writeWorkspaceConfig();
  return c.json(r);
});
app.post('/api/computer/retry', async (c) => {
  const r = await retrySetup();
  return 'error' in r ? c.json(r, 409) : c.json(r);
});
app.post('/api/computer/disconnect', async (c) => {
  await disconnectComputer();
  await writeConnectorsConfig();
  await writeWorkspaceConfig();
  return c.json({ ok: true });
});
app.get('/api/computer/screen', async (c) => {
  try {
    return c.json(await screen(c.req.query('wake') === '1'));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});
// The person taking over the browser: acts directly, no approval, because it is the person acting.
app.post(
  '/api/computer/act',
  json(
    z.discriminatedUnion('action', [
      z.object({ action: z.literal('click'), x: z.number().min(0).max(10000), y: z.number().min(0).max(10000) }),
      z.object({ action: z.literal('type'), text: z.string().max(5000), submit: z.boolean().optional() }),
      z.object({ action: z.literal('press'), key: z.string().max(40) }),
      z.object({ action: z.literal('open'), url: z.string().max(2000) }),
    ]),
  ),
  async (c) => {
    const { action, ...args } = c.req.valid('json');
    try {
      await browser(action, args);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  },
);

app.route('/api', api);
app.use('*', serveStatic({ root: WEB_DIST }));
app.get('*', serveStatic({ root: WEB_DIST, path: 'index.html' }));
