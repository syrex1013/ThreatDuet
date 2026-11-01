// Real end-to-end check of Duet's cloud computer: your Instabox account, a real browser, a real Duet turn.
//
//   INSTABOX_API_KEY=ibk_... npm run smoke:computer
//   INSTABOX_MACHINE=my-machine-name INSTABOX_API_KEY=... npm run smoke:computer   (default machine: dev)
//
// Runs ThreatDuet in a throwaway folder (your real ThreatDuet data is not touched), connects the machine,
// and removes the connection again at the end. The machine itself is left as it was. Needs `npm run build` first.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const key = process.env.INSTABOX_API_KEY;
if (!key) {
  console.error('Set INSTABOX_API_KEY first (create one under API keys in the Instabox dashboard).');
  process.exit(2);
}
const wanted = process.env.INSTABOX_MACHINE || 'dev';
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'threatduet-smoke-'));
process.env.THREATDUET_HOME = home;
process.env.LOG_LEVEL = 'warn';

const { startServer } = await import('../dist/server/server.js');
const server = await startServer({ port: 0 });
const U = `http://127.0.0.1:${server.port}/api`;
const H = { 'content-type': 'application/json', 'x-duet': '1' };
const call = async (method, p, body) => {
  const r = await fetch(U + p, { method, headers: H, body: body && JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
  return ok;
};
const redact = (s) => String(s ?? '').split(key).join('<key>');

async function run() {
  const list = await call('POST', '/computer/machines', { apiKey: key });
  if (!check('Instabox accepts the key and lists machines', list.status === 200, redact(list.json.error))) return;
  const machine = list.json.machines.find((m) => m.name === wanted || m.id === wanted);
  if (!check(`machine "${wanted}" exists`, Boolean(machine), `found: ${list.json.machines.map((m) => m.name).join(', ')}`)) return;
  check('machine has a browser desktop', machine.hasBrowser, 'needs the agent-browser template');
  if (machine.vault) console.log('NOTE  this machine has Vault delivery on: anything Duet runs there could read your Vault secrets');

  const connect = await call('POST', '/computer/connect', { apiKey: key, machineId: machine.id });
  if (!check('connect accepted', connect.status === 200, redact(connect.json.error))) return;
  let status;
  for (let i = 0; i < 200; i++) {
    await sleep(1500);
    status = (await call('GET', '/computer')).json;
    if (!status.setup?.running) break;
  }
  if (!check('setup finished (wake, driver, browser, test page)', status.connected && !status.setup, redact(status.setup?.error))) return;

  const shot = (await call('GET', '/computer/screen')).json;
  check('screenshot comes back as an image', Boolean(shot.base64) && shot.mime === 'image/jpeg', redact(shot.error));

  const opened = await call('POST', '/computer/act', { action: 'open', url: 'https://example.com' });
  check('person can open a page in the browser', opened.status === 200, redact(opened.json.error));
  const pressed = await call('POST', '/computer/act', { action: 'press', key: 'Tab' });
  check('person can press a key', pressed.status === 200, redact(pressed.json.error));

  // A real Duet turn: Kilo, its permissions, and the computer's tools over MCP.
  await call('POST', '/settings', { openWebPages: true, checkEveryHours: 0, briefAt: '23:58', reportAt: '23:59' });
  const before = (await call('GET', '/state')).json.messages.length;
  await call('POST', '/message', { text: 'Open https://example.com on your computer, read the page, and tell me its title in one sentence.' });
  await sleep(3000);
  let state;
  for (let i = 0; i < 100; i++) {
    state = (await call('GET', '/state')).json;
    if (!state.busy && state.messages.length > before + 1) break;
    await sleep(3000);
  }
  const reply = state.messages.at(-1);
  const done = (r, name) => (r.tools ?? []).some((t) => t.tool === name && t.status === 'completed');
  check('Duet opened the page on its computer on its own', done(reply, 'computer_browser_open'), (reply.tools ?? []).map((t) => `${t.tool}:${t.status}`).join(', ') || 'no tools used');
  check('Duet answered from the page', /example domain/i.test(reply.text), reply.text.slice(0, 100));

  // Acting is held back for approval.
  await call('POST', '/settings', { openWebPages: false });
  const n = (await call('GET', '/state')).json.messages.length;
  await call('POST', '/message', { text: 'On your computer, open the page https://example.com/ and click its "Learn more" link.' });
  await sleep(3000);
  for (let i = 0; i < 100; i++) {
    state = (await call('GET', '/state')).json;
    if (!state.busy && state.messages.length > n + 1) break;
    await sleep(3000);
  }
  const held = state.messages.at(-1);
  // A refused attempt is listed with an error status; only a completed click would be a failure.
  check('clicking waits for approval (nothing was clicked)', held.proposal?.status === 'pending' && !done(held, 'computer_browser_click'), held.proposal ? 'proposal pending' : 'no proposal');
}

try {
  await run();
} catch (e) {
  failed++;
  console.log(`FAIL  unexpected error: ${redact(e?.message)}`);
} finally {
  await call('POST', '/computer/disconnect').catch(() => {});
  await server.close().catch(() => {});
  await fs.rm(home, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
