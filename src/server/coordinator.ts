import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { DATA_DIR } from './config.js';

/** One coordinator per data directory; never steal a lock from another host. */
export async function acquireCoordinator(): Promise<() => Promise<void>> {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(DATA_DIR, 'coordinator.lock');
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(file, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, host: os.hostname(), token })); }
      finally { await handle.close(); }
      return async () => {
        const lock = JSON.parse(await fs.readFile(file, 'utf8').catch(() => 'null'));
        if (lock?.token === token) await fs.unlink(file);
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const lock = JSON.parse(await fs.readFile(file, 'utf8').catch(() => 'null'));
      if (!lock || lock.host !== os.hostname() || !Number.isInteger(lock.pid) || lock.pid <= 0) throw new Error('Coordinator lock requires manual review.');
      const recovery = `${file}.recovery`;
      const claim = await fs.open(recovery, 'wx', 0o600).catch(() => null);
      if (!claim) throw new Error('Coordinator recovery is already in progress.');
      try {
        const current = JSON.parse(await fs.readFile(file, 'utf8').catch(() => 'null'));
        if (!current || current.host !== os.hostname() || !Number.isInteger(current.pid) || current.pid <= 0) throw new Error('Coordinator lock requires manual review.');
        let alive = true;
        try { process.kill(current.pid, 0); }
        catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
        if (alive) throw new Error('A coordinator is already using this data directory.');
        await fs.unlink(file);
      } finally { await claim.close(); await fs.unlink(recovery); }
    }
  }
  throw new Error('Could not acquire coordinator lock.');
}
