import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
export interface Tenant { id: string; name: string; administrator: boolean; createdAt: number }
interface RegistryData {
  tenants: Tenant[];
  invites: { hash: string; expiresAt: number; used: boolean }[];
  installations: { hash: string; tenantId: string; installationId: string; revoked: boolean }[];
  migration: { backup: string; sha256: string; restored: boolean } | null;
}

/** Private host-only registry. Mutations are serialized and committed before credentials leave the broker. */
export class Registry {
  private data: RegistryData = { tenants: [], invites: [], installations: [], migration: null };
  private tail = Promise.resolve();
  constructor(private readonly file: string) {}
  async open() {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await fs.chmod(path.dirname(this.file), 0o700);
    try { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  private mutate<T>(change: () => T): Promise<T> {
    const run = this.tail.then(async () => {
      const before = structuredClone(this.data);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const result = change();
        await fs.writeFile(temporary, JSON.stringify(this.data), { mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, this.file);
        return result;
      } catch (error) { this.data = before; await fs.rm(temporary, { force: true }); throw error; }
    });
    this.tail = run.then(() => {}, () => {});
    return run;
  }
  authenticate(token: string): Tenant | undefined {
    if (!token || token.length > 200) return;
    const hash = digest(token);
    const entry = this.data.installations.find((i) => !i.revoked && i.hash === hash);
    return entry && this.data.tenants.find((t) => t.id === entry.tenantId);
  }
  private install(tenant: Tenant, installationId: string) {
    const token = secret();
    this.data.installations.push({ hash: digest(token), tenantId: tenant.id, installationId, revoked: false });
    return { tenant, token };
  }
  bootstrap() {
    return this.mutate(() => {
      if (this.data.tenants.length) throw new Error('Administrator already exists.');
      const tenant = { id: randomUUID(), name: 'Administrator', administrator: true, createdAt: Date.now() };
      this.data.tenants.push(tenant);
      return this.install(tenant, randomUUID());
    });
  }
  migrationReady() { return Boolean(this.data.migration?.restored); }
  administrator() { return this.data.tenants.find((tenant) => tenant.administrator); }
  recordMigration(backup: string, sha256: string) {
    return this.mutate(() => { this.data.migration = { backup, sha256, restored: true }; });
  }
  invite(ttlMs = 15 * 60_000) {
    return this.mutate(() => {
      if (!this.migrationReady()) throw new Error('Administrator backup and restore verification required before enrollment.');
      const code = secret();
      const expiresAt = Date.now() + Math.max(1000, Math.min(ttlMs, 24 * 60 * 60_000));
      this.data.invites = this.data.invites.filter((i) => !i.used && i.expiresAt > Date.now());
      this.data.invites.push({ hash: digest(code), expiresAt, used: false });
      return { code, expiresAt };
    });
  }
  enroll(code: string, installationId: string, name: string) {
    return this.mutate(() => {
      const hash = digest(code);
      const invite = this.data.invites.find((i) => i.hash === hash && !i.used && i.expiresAt > Date.now());
      if (!invite || !this.migrationReady()) throw new Error('Invite is invalid, expired, or already used.');
      invite.used = true;
      const tenant = { id: randomUUID(), name, administrator: false, createdAt: Date.now() };
      this.data.tenants.push(tenant);
      return this.install(tenant, installationId);
    });
  }
  revoke(installationId: string) {
    return this.mutate(() => { for (const i of this.data.installations) if (i.installationId === installationId) i.revoked = true; });
  }
  installations() { return this.data.installations.map(({ hash: _, ...i }) => i); }
}

export function adminTokenMatches(actual: string | undefined, expected: string): boolean {
  const value = actual?.replace(/^Bearer /, '') ?? '';
  return expected.length >= 32 && timingSafeEqual(Buffer.from(digest(value)), Buffer.from(digest(expected)));
}
