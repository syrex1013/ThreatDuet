import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import type { SkillInfo, SkillPreview } from '../shared/skills.js';
import { DATA_DIR, WORKSPACE } from './config.js';
import { db } from './store.js';
import { tr } from './i18n.js';

export interface SkillRecord extends SkillInfo {
  addedAt: number;
}

const SKILLS_DIR = path.join(DATA_DIR, 'skills');
const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_SKILL_BYTES = 1024 * 1024;
const MAX_FILES = 200;
const MAX_DOWNLOAD = 30 * 1024 * 1024;

export function parseSkillMd(text: string): { name: string; description: string; body: string } | { error: string } {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { error: tr('SKILL.md must start with a --- header holding name and description.') };
  const field = (key: string) => {
    const lines = m[1].split('\n');
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (i < 0) return '';
    let v = lines[i].slice(key.length + 1).trim();
    if (/^[>|][+-]?$/.test(v)) {
      const rest: string[] = [];
      for (const l of lines.slice(i + 1)) {
        if (!/^\s/.test(l) && l.trim()) break;
        rest.push(l.trim());
      }
      v = rest.join(' ').trim();
    }
    return v.replace(/^(["'])([\s\S]*)\1$/, '$2');
  };
  const name = field('name');
  const description = field('description');
  if (!NAME.test(name)) return { error: tr('The skill name must be lowercase letters, digits and dashes (up to 40).') };
  if (!description) return { error: tr('The skill needs a description in its header.') };
  return { name, description: description.slice(0, 400), body: m[2].trim() };
}

export interface GithubSource {
  repo: string;
  ref: string;
  path: string;
}

/** github.com/<owner>/<repo>[/tree|blob/<ref>/<folder>]. shortcut: a ref with a slash in it isn't understood. */
export function parseGithubUrl(raw: string): GithubSource | { error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: tr('That is not a link.') };
  }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com') return { error: tr('Use a github.com link to the skill folder.') };
  const [owner, repo, kind, ref, ...rest] = u.pathname.split('/').filter(Boolean);
  const ok = (s: string | undefined) => Boolean(s) && /^[A-Za-z0-9._-]+$/.test(s as string) && s !== '.' && s !== '..';
  if (!ok(owner) || !ok(repo?.replace(/\.git$/, ''))) return { error: tr('Use a link to a GitHub repository.') };
  let dir = rest;
  if (kind === 'blob' && dir.at(-1)?.toLowerCase() === 'skill.md') dir = dir.slice(0, -1);
  if (kind && kind !== 'tree' && kind !== 'blob') return { error: tr('Use a link to a folder in the repository.') };
  if (kind && !ok(ref)) return { error: tr('That branch name is not supported.') };
  if (dir.some((p) => !ok(p))) return { error: tr('That folder path is not supported.') };
  return { repo: `${owner}/${repo.replace(/\.git$/, '')}`, ref: ref ?? 'HEAD', path: dir.join('/') };
}

const sourceText = (g: GithubSource) => `github.com/${g.repo}${g.path ? `/${g.path}` : ''}`;

async function fetchOk(url: string, timeout = 20_000): Promise<Response | { error: string }> {
  const r = await fetch(url, { headers: { 'user-agent': 'ThreatDuet' }, signal: AbortSignal.timeout(timeout) }).catch(() => null);
  if (!r) return { error: tr("Can't reach GitHub. Check your connection.") };
  if (r.status === 404) return { error: tr('No SKILL.md found there. Is the repository public?') };
  if (!r.ok) return { error: tr('GitHub answered {status}.', { status: r.status }) };
  return r;
}

export async function previewSkill(src: { url?: string; text?: string }): Promise<SkillPreview | { error: string }> {
  if (src.text !== undefined) {
    const p = parseSkillMd(src.text);
    return 'error' in p ? p : { ...p, source: 'pasted' };
  }
  const raw = (src.url ?? '').trim();
  if (/^https:\/\//i.test(raw) && /skill\.md(\?|$)/i.test(raw)) {
    const got = await fetchRemoteSkill(raw);
    if ('error' in got) return got;
    const p = parseSkillMd(got.text);
    return 'error' in p ? p : { ...p, source: got.source };
  }
  const g = parseGithubUrl(raw);
  if ('error' in g) return g;
  const r = await fetchOk(`https://raw.githubusercontent.com/${g.repo}/${g.ref}/${g.path ? `${g.path}/` : ''}SKILL.md`);
  if ('error' in r) return r;
  const p = parseSkillMd((await r.text()).slice(0, 200_000));
  return 'error' in p ? p : { ...p, source: sourceText(g) };
}

async function walk(dir: string, acc: { bytes: number; files: number }): Promise<string | null> {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) return tr('The skill contains a link to another place, which is not allowed.');
    if (e.isDirectory()) {
      const bad = await walk(p, acc);
      if (bad) return bad;
    } else {
      acc.files++;
      acc.bytes += (await fs.stat(p)).size;
    }
    if (acc.bytes > MAX_SKILL_BYTES || acc.files > MAX_FILES) return tr('That skill is too big (1 MB or 200 files at most).');
  }
  return null;
}

/** Downloads the repo archive and keeps only the skill folder, in a scratch folder under the data folder. */
async function fetchFolder(g: GithubSource, tmp: string): Promise<string | { error: string }> {
  const r = await fetchOk(`https://codeload.github.com/${g.repo}/tar.gz/${g.ref}`, 60_000);
  if ('error' in r) return r;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of r.body as unknown as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_DOWNLOAD) return { error: tr('That repository is too big to download here.') };
    chunks.push(c);
  }
  const archive = path.join(tmp, 'repo.tgz');
  await fs.writeFile(archive, Buffer.concat(chunks));
  const out = path.join(tmp, 'x');
  await fs.mkdir(out);
  // bsdtar (macOS): --include limits extraction to the folder, so a big repo isn't unpacked whole.
  const args = ['-xzf', archive, '-C', out, ...(g.path ? ['--include', `*/${g.path}/*`] : [])];
  const t = await execa('tar', args, { reject: false });
  if (t.exitCode !== 0) return { error: tr("Couldn't find that folder in the repository.") };
  const top = (await fs.readdir(out))[0];
  const dir = top ? path.join(out, top, g.path) : '';
  if (!dir || !(await fs.stat(path.join(dir, 'SKILL.md')).catch(() => null))) return { error: tr('No SKILL.md found in that folder.') };
  return dir;
}


/** Fetches a public SKILL.md (and optional references/) over https. Used for Shop and similar. */
async function fetchRemoteSkill(url: string): Promise<{ text: string; source: string } | { error: string }> {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return { error: tr('That is not a link.') };
  }
  if (u.protocol !== 'https:') return { error: tr('Use an https:// address for the skill.') };
  const r = await fetchOk(u.toString());
  if ('error' in r) return r;
  const text = (await r.text()).slice(0, 200_000);
  if (!text.includes('---')) return { error: tr('SKILL.md must start with a --- header holding name and description.') };
  return { text, source: u.hostname + u.pathname };
}

export async function installSkill(src: { url?: string; text?: string }): Promise<{ name: string } | { error: string }> {
  await fs.mkdir(SKILLS_DIR, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(SKILLS_DIR, '.tmp-'));
  try {
    let dir: string;
    let source: string;
    if (src.text !== undefined) {
      dir = path.join(tmp, 'skill');
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'SKILL.md'), src.text.slice(0, MAX_SKILL_BYTES));
      source = 'pasted';
    } else {
      const raw = (src.url ?? '').trim();
      if (/^https:\/\//i.test(raw) && /skill\.md(\?|$)/i.test(raw)) {
        const got = await fetchRemoteSkill(raw);
        if ('error' in got) return got;
        dir = path.join(tmp, 'skill');
        await fs.mkdir(dir);
        await fs.writeFile(path.join(dir, 'SKILL.md'), got.text.slice(0, MAX_SKILL_BYTES));
        source = got.source;
      } else {
        const g = parseGithubUrl(raw);
        if ('error' in g) return g;
        const got = await fetchFolder(g, tmp);
        if (typeof got !== 'string') return got;
        dir = got;
        source = sourceText(g);
      }
    }
    const bad = await walk(dir, { bytes: 0, files: 0 });
    if (bad) return { error: bad };
    const parsed = parseSkillMd(await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8'));
    if ('error' in parsed) return parsed;
    const dest = path.join(SKILLS_DIR, parsed.name);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.rename(dir, dest);
    const prior = db.data.skills.find((s) => s.name === parsed.name);
    db.data.skills = db.data.skills.filter((s) => s.name !== parsed.name);
    db.data.skills.push({ name: parsed.name, description: parsed.description, enabled: prior?.enabled ?? true, source, addedAt: Date.now() });
    await db.write();
    return { name: parsed.name };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export const listSkills = (): SkillInfo[] => db.data.skills.map(({ name, description, enabled, source }) => ({ name, description, enabled, source }));

export async function updateSkill(name: string, enabled: boolean): Promise<boolean> {
  const s = db.data.skills.find((x) => x.name === name);
  if (!s) return false;
  s.enabled = enabled;
  await db.write();
  return true;
}

export async function removeSkill(name: string): Promise<boolean> {
  if (!db.data.skills.some((x) => x.name === name)) return false;
  db.data.skills = db.data.skills.filter((x) => x.name !== name);
  await db.write();
  await fs.rm(path.join(SKILLS_DIR, name), { recursive: true, force: true });
  return true;
}

/** Puts the enabled skills where kilo looks. The agent can't edit `.kilo`; this runs before every turn. */
export async function copySkills(): Promise<void> {
  const target = path.join(WORKSPACE, '.kilo', 'skills');
  await fs.rm(target, { recursive: true, force: true });
  for (const s of db.data.skills.filter((x) => x.enabled && NAME.test(x.name))) {
    await fs.cp(path.join(SKILLS_DIR, s.name), path.join(target, s.name), { recursive: true }).catch(() => undefined);
  }
}
