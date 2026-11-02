import path from 'node:path';
import fs from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { Registry } from './registry.js';
import { DockerSandbox } from './docker.js';
import { buildBroker } from './server.js';

const home = process.env.DUET_BROKER_HOME;
const admin = process.env.DUET_BROKER_ADMIN_TOKEN;
if (!home || !admin || admin.length < 32) throw new Error('DUET_BROKER_HOME and a strong DUET_BROKER_ADMIN_TOKEN are required.');
if (process.env.DUET_LEGACY_CREDENTIAL_REVOKED !== 'yes') throw new Error('Revoke the previously distributed Instabox credential before enabling the broker.');
await fs.mkdir(home, { recursive: true, mode: 0o700 });
const lockPath = path.join(home, 'broker.lock');
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
const acquire = () => fs.open(lockPath, 'wx', 0o600);
const lock = await acquire().catch(async () => {
  // A SIGKILL, OOM or power loss leaves the lock behind; only a lock whose process is gone is stale.
  const pid = Number.parseInt(await fs.readFile(lockPath, 'utf8').catch(() => ''), 10);
  if (Number.isInteger(pid) && pid > 0 && !alive(pid)) { await fs.unlink(lockPath).catch(() => undefined); return acquire(); }
  throw new Error('Broker registry already locked. Stop the other broker, or inspect a stale lock before recovery.');
}).catch((e: Error) => { throw e.message.startsWith('Broker registry') ? e : new Error('Broker registry already locked. Stop the other broker, or inspect a stale lock before recovery.'); });
await lock.writeFile(`${process.pid}\n`); await lock.close();
process.once('exit', () => { try { unlinkSync(lockPath); } catch {} });
process.once('SIGTERM', () => process.exit(0));
process.once('SIGINT', () => process.exit(0));
const registry = new Registry(path.join(home, 'registry.json'));
await registry.open();
const sandbox = new DockerSandbox(process.env.DUET_TENANT_IMAGE ?? '', (process.env.DUET_BLOCKED_HOSTS ?? '').split(',').filter(Boolean), process.env.DUET_VOLUME_BASE);
const app = buildBroker(registry, sandbox, admin);
// TLS terminates at the administrator's reverse proxy. Never expose the plain HTTP listener publicly.
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.DUET_BROKER_PORT ?? 4340) });
