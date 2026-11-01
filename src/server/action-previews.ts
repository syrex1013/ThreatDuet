import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ExactCall } from '../shared/types.js';
import { resolveAllowed } from './mac/files.js';

export interface FilePreview { path: string; before: string; hash: string }

async function readVersion(raw: string): Promise<FilePreview> {
  const file = await resolveAllowed(raw, { forWrite: true });
  const stat = await fs.stat(file).catch((e) => { if (e.code === 'ENOENT') return null; throw e; });
  if (!stat) return { path: raw, before: '', hash: 'missing' };
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error('File preview requires a text file up to 1 MB.');
  const bytes = await fs.readFile(file);
  if (bytes.includes(0)) throw new Error('Cannot preview replacement of a binary file.');
  return { path: raw, before: bytes.toString('utf8'), hash: createHash('sha256').update(bytes).digest('hex') };
}

export async function previewCalls(calls: ExactCall[]): Promise<FilePreview[]> {
  const previews: FilePreview[] = [];
  for (const call of calls) if (call.tool === 'local_files_write' && typeof call.arguments.path === 'string') previews.push(await readVersion(call.arguments.path));
  return previews;
}

export async function checkPreviews(previews: FilePreview[] = []): Promise<void> {
  for (const preview of previews) if ((await readVersion(preview.path)).hash !== preview.hash) throw new Error('File changed since approval preview. Prepare a new proposal before writing.');
}
