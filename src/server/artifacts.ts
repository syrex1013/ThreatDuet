import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DATA_DIR, WORKSPACE } from './config.js';
import { db, PROTECTED } from './store.js';
import { SKIP } from './direct/tools.js';

const BLOBS = path.join(DATA_DIR, 'revisions');
const LIMIT = 10_000_000;

/** Existing parents must resolve inside the workspace; protected configuration stays private. */
export async function artifactPath(raw: string): Promise<string> {
  if (!raw || raw.includes('\\') || path.isAbsolute(raw) || raw.split('/').some((p) => p === '..' || SKIP.has(p)) || PROTECTED.includes(raw.split('/')[0])) throw new Error('Only workspace deliverables are allowed.');
  const root = await fs.realpath(WORKSPACE);
  const target = path.resolve(root, raw);
  let probe = target;
  while (!(await fs.lstat(probe).catch(() => null)) && probe !== root) probe = path.dirname(probe);
  const resolved = await fs.realpath(probe);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Path leaves workspace.');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    if ((await fs.lstat(current).catch(() => null))?.isSymbolicLink()) throw new Error('Symbolic links are not deliverables.');
  }
  return target;
}

export async function verifyArtifact(raw: string): Promise<boolean> {
  try { const stat = await fs.stat(await artifactPath(raw)); return stat.isFile() && stat.size > 0; } catch { return false; }
}

export async function snapshotArtifact(raw: string, source: string, taskId?: string, projectId?: string): Promise<void> {
  const abs = await artifactPath(raw);
  const stat = await fs.stat(abs);
  if (!stat.isFile() || stat.size > LIMIT) return;
  const bytes = await fs.readFile(abs);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (db.data.revisions.findLast((r) => r.path === raw)?.hash === hash) return;
  await fs.mkdir(BLOBS, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(BLOBS, hash), bytes, { flag: 'wx', mode: 0o600 }).catch((e) => { if (e.code !== 'EEXIST') throw e; });
  db.data.revisions.push({ id: randomUUID(), path: raw, hash, size: bytes.length, createdAt: Date.now(), source, taskId, projectId });
  const project = db.data.projects.find((p) => p.id === projectId);
  if (project && !project.files.includes(raw)) project.files.push(raw);
  await db.write();
}

export async function snapshotArtifacts(taskId?: string, projectId?: string): Promise<void> {
  const walk = async (dir: string, prefix = ''): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name) || (!prefix && PROTECTED.includes(e.name)) || e.isSymbolicLink()) continue;
      const raw = prefix + e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), raw + '/');
      else if (e.isFile()) await snapshotArtifact(raw, db.data.tasks.find((t) => t.id === taskId)?.title ?? 'workspace checkpoint', taskId, projectId);
    }
  };
  await walk(WORKSPACE);
}

export async function revisionBytes(id: string): Promise<Buffer> {
  const revision = db.data.revisions.find((r) => r.id === id);
  if (!revision) throw new Error('Revision not found.');
  const bytes = await fs.readFile(path.join(BLOBS, revision.hash));
  if (createHash('sha256').update(bytes).digest('hex') !== revision.hash) throw new Error('Revision integrity check failed.');
  return bytes;
}

export async function restoreRevision(id: string): Promise<void> {
  const revision = db.data.revisions.find((r) => r.id === id);
  if (!revision) throw new Error('Revision not found.');
  const abs = await artifactPath(revision.path);
  if (await fs.stat(abs).catch(() => null)) await snapshotArtifact(revision.path, 'before restore');
  const bytes = await revisionBytes(id);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const temp = `${abs}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, bytes, { mode: 0o600 }); await fs.rename(temp, abs); }
  finally { await fs.unlink(temp).catch(() => undefined); }
  await snapshotArtifact(revision.path, `restored ${id}`, revision.taskId, revision.projectId);
}
