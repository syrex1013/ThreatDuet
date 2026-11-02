// Run against an already enrolled private test workspace. Never accepts provider credentials.
// DUET_BROKER_URL=https://... DUET_INSTALLATION_TOKEN=... bun run smoke:computer
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

if (!process.env.DUET_BROKER_URL || !process.env.DUET_INSTALLATION_TOKEN) throw new Error('DUET_BROKER_URL and DUET_INSTALLATION_TOKEN required.');
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'duet-private-smoke-'));
process.env.THREATDUET_HOME = home;
process.env.LOG_LEVEL = 'warn';
const { startServer } = await import('../dist/server/server.js');
const server = await startServer({ port: 0 });
const call = async (route, body) => {
  const response = await fetch(`http://127.0.0.1:${server.port}/api${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-duet': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert(response.ok, `Private cloud check failed (${route}): ${result.error || response.status}`);
  return result;
};
try {
  await call('/computer/attach', { url: process.env.DUET_BROKER_URL, token: process.env.DUET_INSTALLATION_TOKEN });
  const status = await call('/computer');
  assert.equal(status.error, null, status.error || 'Cloud isolation unavailable.');
  assert.equal(status.connected, true);
  await call('/computer/act', { action: 'open', url: 'https://example.com' });
  const screen = await call('/computer/screen');
  assert(screen.base64 && screen.mime === 'image/jpeg', 'Private screenshot missing.');
  await call('/browser/computer/takeover', {});
  await call('/browser/computer/takeover/finish', {});
  console.log('PASS private enrollment, browser, screenshot and takeover');
} finally {
  await server.close();
  await fs.rm(home, { recursive: true, force: true });
}
