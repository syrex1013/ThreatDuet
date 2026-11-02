import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { Registry } from './registry.js';

describe('tenant registry', () => {
  it('requires migration, consumes invites, and revokes tokens', async () => {
    const dir = await mkdtemp('/tmp/duet-registry-'); const r = new Registry(path.join(dir, 'registry.json')); await r.open();
    const admin = await r.bootstrap();
    await expect(r.invite()).rejects.toThrow(/verification/);
    await r.recordMigration('/tmp/backup.tar', 'hash');
    const invite = await r.invite(1000);
    const user = await r.enroll(invite.code, 'install-1', 'User');
    expect(r.authenticate(user.token)?.id).toBe(user.tenant.id);
    await expect(r.enroll(invite.code, 'install-2', 'Reuse')).rejects.toThrow(/invalid/);
    await r.revoke('install-1'); expect(r.authenticate(user.token)).toBeUndefined();
    expect(r.authenticate(admin.token)?.administrator).toBe(true);
  });
});
