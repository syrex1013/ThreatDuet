import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { execa } from 'execa';
import { Registry } from './registry.js';

const sha256 = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const locks = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket']);
export interface MigrationReceipt { tenantId: string; backup: string; sha256: string; target: string; manifest: Record<string, string> }

/** Host-only migration refuses escaping links and compares every restored file with the staged backup. */
async function manifest(root: string, relative = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    if (locks.has(entry.name) || entry.name === 'lost+found') continue;
    const name = path.join(relative, entry.name);
    const full = path.join(root, name);
    if (entry.isSymbolicLink()) {
      const link = await fs.readlink(full);
      const resolved = path.resolve(path.dirname(full), link);
      if (path.isAbsolute(link) || !resolved.startsWith(`${path.resolve(root)}/`)) throw new Error('Migration refuses links outside their private source.');
      result[name] = `link:${link}`;
    } else if (entry.isDirectory()) Object.assign(result, await manifest(root, name));
    else if (entry.isFile()) result[name] = await sha256(full);
    else throw new Error('Migration refuses device files, sockets, and pipes. Stop the browser before migration.');
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

export async function migrateAdministrator(registry: Registry, workspace: string, profile: string, backupDir: string, target: string): Promise<MigrationReceipt> {
  const administrator = registry.administrator();
  if (!administrator) throw new Error('Bootstrap administrator before migration.');
  const destination = await fs.realpath(target);
  if ((await fs.readdir(destination)).some((name) => name !== 'lost+found')) throw new Error('Administrator target volume must be empty.');
  const backups = path.resolve(backupDir);
  for (const source of [workspace, profile]) {
    const actual = await fs.realpath(source);
    if (backups === actual || backups.startsWith(`${actual}/`) || destination === actual || destination.startsWith(`${actual}/`)) throw new Error('Backup and target must be outside source folders.');
    await manifest(actual);
  }
  await fs.mkdir(backups, { recursive: true, mode: 0o700 });
  await fs.chmod(backups, 0o700);
  const stage = await fs.mkdtemp(path.join(backups, '.migration-'));
  const backup = path.join(backups, `administrator-${Date.now()}.tar`);
  try {
    // Live host currently stores these under /data/home/openduet and /data/workspace/openduet.
    // Inside tenant volumes keep the sandbox layout expected by the broker driver.
    for (const [source, relative] of [[workspace, 'workspace/threatduet'], [profile, 'home/threatduet/profile']]) {
      const to = path.join(stage, relative);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.cp(source, to, { recursive: true, dereference: false, verbatimSymlinks: true, filter: (name) => !locks.has(path.basename(name)) });
    }
    const expected = await manifest(stage);
    await execa('tar', ['-cf', backup, '-C', stage, '.']);
    await fs.chmod(backup, 0o600);
    const digest = await sha256(backup);
    await execa('tar', ['--no-same-owner', '--no-same-permissions', '-xf', backup, '-C', destination]);
    if (JSON.stringify(await manifest(destination)) !== JSON.stringify(expected) || await sha256(backup) !== digest) throw new Error('Restored data differs from backup. Enrollment remains disabled.');
    if (process.getuid?.() === 0) await execa('chown', ['-R', '1000:1000', '--', destination]);
    const receipt: MigrationReceipt = { tenantId: administrator.id, backup, sha256: digest, target: destination, manifest: expected };
    await fs.writeFile(`${backup}.receipt.json`, JSON.stringify(receipt, null, 2), { mode: 0o600, flag: 'wx' });
    return receipt;
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

/** Enrollment remains closed until administrator reviews live browser login and source credential revocation. */
export async function verifyMigration(registry: Registry, receipt: MigrationReceipt, evidenceFile: string): Promise<void> {
  const evidence = JSON.parse(await fs.readFile(evidenceFile, 'utf8'));
  if (receipt.tenantId !== registry.administrator()?.id || evidence.tenantId !== receipt.tenantId || evidence.browserLoginVerified !== true || evidence.legacyCredentialRevoked !== true || typeof evidence.notes !== 'string' || evidence.notes.length < 20 || !Number.isFinite(Date.parse(evidence.verifiedAt)) || Math.abs(Date.now() - Date.parse(evidence.verifiedAt)) > 86_400_000) throw new Error('Recent administrator login and credential-revocation evidence required.');
  const workspaceOnly = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith('workspace/')));
  if (await sha256(receipt.backup) !== receipt.sha256 || JSON.stringify(workspaceOnly(await manifest(receipt.target))) !== JSON.stringify(workspaceOnly(receipt.manifest))) throw new Error('Backup or restored workspace changed since migration verification.');
  await registry.recordMigration(receipt.backup, receipt.sha256);
}

if (import.meta.main) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { workspace: { type: 'string' }, profile: { type: 'string' }, target: { type: 'string' }, 'backup-dir': { type: 'string' }, receipt: { type: 'string' }, evidence: { type: 'string' } } });
  const home = process.env.DUET_BROKER_HOME;
  if (!home) throw new Error('DUET_BROKER_HOME required. Stop broker before host-only administration.');
  try { await fs.access(path.join(home, 'broker.lock')); throw new Error('Stop broker before host-only registry administration.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const registry = new Registry(path.join(home, 'registry.json')); await registry.open();
  if (positionals[0] === 'bootstrap') {
    const result = await registry.bootstrap();
    console.log(JSON.stringify({ tenantId: result.tenant.id, installationId: registry.installations()[0].installationId, token: result.token }));
  } else if (positionals[0] === 'migrate' && values.workspace && values.profile && values.target && values['backup-dir']) {
    const receipt = await migrateAdministrator(registry, values.workspace, values.profile, values['backup-dir'], values.target);
    console.log(JSON.stringify({ receipt: `${receipt.backup}.receipt.json`, sha256: receipt.sha256, files: Object.keys(receipt.manifest).length }));
  } else if (positionals[0] === 'verify-migration' && values.receipt && values.evidence) {
    await verifyMigration(registry, JSON.parse(await fs.readFile(values.receipt, 'utf8')), values.evidence);
    console.log('Administrator backup and restore verified. Restart broker to load migration state.');
  } else throw new Error('Usage: broker:admin bootstrap | migrate --workspace PATH --profile PATH --target PATH --backup-dir PATH | verify-migration --receipt PATH --evidence PATH');
}
