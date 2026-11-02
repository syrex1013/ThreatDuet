import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { Registry } from './registry.js';
import { migrateAdministrator, verifyMigration } from './admin.js';

describe('administrator migration', () => it('restores workspace and profile, then requires reviewed evidence', async () => {
  const root = await mkdtemp('/tmp/duet-admin-'); const workspace = path.join(root, 'workspace'); const profile = path.join(root, 'profile'); const target = path.join(root, 'target'); const backups = path.join(root, 'backups');
  await fs.mkdir(workspace, { recursive: true }); await fs.mkdir(profile, { recursive: true }); await fs.mkdir(target); await fs.mkdir(path.join(target, 'lost+found')); await fs.writeFile(path.join(workspace, 'note.txt'), 'keep'); await fs.writeFile(path.join(profile, 'Cookies'), 'profile');
  const registry = new Registry(path.join(root, 'registry.json')); await registry.open(); await registry.bootstrap();
  const receipt = await migrateAdministrator(registry, workspace, profile, backups, target);
  expect(registry.migrationReady()).toBe(false); expect(await fs.readFile(path.join(target, 'workspace/threatduet/note.txt'), 'utf8')).toBe('keep');
  const evidence = path.join(root, 'evidence.json'); await fs.writeFile(evidence, JSON.stringify({ tenantId: receipt.tenantId, browserLoginVerified: true, legacyCredentialRevoked: true, notes: 'Reviewed login and credential revocation.', verifiedAt: new Date().toISOString() }));
  await verifyMigration(registry, receipt, evidence); expect(registry.migrationReady()).toBe(true);
}));
