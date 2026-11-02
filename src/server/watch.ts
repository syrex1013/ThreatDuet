import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { browser, screen } from './computer/machine.js';
import { browse as localBrowse, takeoverBrowser, finishTakeover, browserInteractive } from './mac/browser.js';
import { BrokerClient } from './computer/broker-client.js';
import { cancelInputs } from './input.js';
import { db } from './store.js';
import { tr } from './i18n.js';

const json = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (r, c) => {
    if (!r.success) return c.json({ error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  });

const Act = z.discriminatedUnion('action', [
  z.object({ action: z.literal('click'), x: z.number().min(0).max(10000), y: z.number().min(0).max(10000) }),
  z.object({ action: z.literal('type'), text: z.string().max(5000), submit: z.boolean().optional(), manual: z.boolean().optional() }),
  z.object({ action: z.literal('press'), key: z.string().max(40), manual: z.boolean().optional() }),
  z.object({ action: z.literal('open'), url: z.string().max(2000) }),
]);

/**
 * Live browser watch/control. Mounted on the local app and on the phone listener so a paired
 * phone can sign into sites (with the secure input prompt) while this computer does the work.
 */
export const watchApi = new Hono()
  .post('/browser/local/takeover', async (c) => {
    if (!db.data.mac.browser) return c.json({ error: 'Local browser is disabled.' }, 409);
    cancelInputs({ target: 'local' });
    try { await takeoverBrowser(); return c.json({ ok: true }); }
    catch { return c.json({ error: 'Visible browser could not start. Return control before retrying automation.' }, 409); }
  })
  .post('/browser/local/takeover/finish', async (c) => {
    await finishTakeover();
    return c.json({ ok: true });
  })
  .post('/browser/computer/takeover', async (c) => {
    if (!db.data.cloudBroker) return c.json({ error: 'Private cloud workspace is not connected.' }, 409);
    cancelInputs({ target: 'computer' });
    try { return c.json(await new BrokerClient(db.data.cloudBroker).operation('takeover', { enabled: true }, true)); }
    catch (error) { return c.json({ error: (error as Error).message }, 409); }
  })
  .post('/browser/computer/takeover/finish', async (c) => {
    if (!db.data.cloudBroker) return c.json({ error: 'Private cloud workspace is not connected.' }, 409);
    try {
      await new BrokerClient(db.data.cloudBroker).operation('takeover', { enabled: false }, true);
      // A new observation invalidates old element references before automation resumes.
      await browser('read');
      return c.json({ ok: true });
    } catch (error) { return c.json({ error: (error as Error).message }, 409); }
  })
  .get('/mac/screen', async (c) => {
    try {
      if (!db.data.mac.browser) return c.json({ error: tr('The browser on this computer is turned off. Turn it on in the Your Mac / Your PC panel.') }, 400);
      const r = await localBrowse('screenshot', { manual: true });
      return c.json({ asleep: false, url: r.url, title: r.title, mime: r.mime, base64: r.base64, browserMode: browserInteractive() ? 'interactive' : 'automatic' });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  })
  .post('/mac/act', json(Act), async (c) => {
    if (!db.data.mac.browser) return c.json({ error: tr('The browser on this computer is turned off. Turn it on in the Your Mac / Your PC panel.') }, 400);
    const { action, ...args } = c.req.valid('json');
    try {
      await localBrowse(action, { ...args, manual: true });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  })
  .get('/computer/screen', async (c) => {
    try {
      return c.json(await screen(c.req.query('wake') === '1'));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  })
  .post('/computer/act', json(Act), async (c) => {
    const { action, ...args } = c.req.valid('json');
    try {
      await browser(action, args, true);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });
