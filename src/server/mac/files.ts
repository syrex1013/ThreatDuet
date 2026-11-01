import fs from 'node:fs/promises';
import { OS_PANEL } from './os.js';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, WORKSPACE } from '../config.js';
import { db, PROTECTED } from '../store.js';

const HOME = () => os.homedir();

/** Credential stores that stay off-limits even inside a folder the person added (e.g. their whole home). */
const sensitive = (): string[] => {
  const h = HOME();
  return [
    DATA_DIR, // ThreatDuet's own keys, app credentials and the copied browser profile
    ...['.ssh', '.gnupg', '.aws', '.kube', '.azure', '.config/gcloud', '.config/gh', '.docker', '.claude', '.claude.json', '.codex', '.netrc', '.npmrc', '.git-credentials', '.config/kilo', '.local/share/kilo', '.config/opencode', '.local/share/opencode'].map((p) => path.join(h, p)),
    ...(process.platform === 'win32' ? ['C:\\Windows\\System32\\config'] : ['/Library/Keychains', '/private/var/db', '/private/var/root', '/private/etc/sudoers', '/private/etc/master.passwd']),
    ...(process.platform === 'win32'
      ? ['AppData/Local/BraveSoftware', 'AppData/Local/Google/Chrome', 'AppData/Local/Microsoft/Edge', 'AppData/Local/Microsoft/Credentials', 'AppData/Roaming/Microsoft/Credentials', 'AppData/Roaming/Microsoft/Protect', 'AppData/Roaming/Mozilla/Firefox', 'AppData/Roaming/1Password', 'NTUSER.DAT'].map((p) => path.join(h, p))
      : []),
    ...(process.platform === 'linux'
      ? (() => {
          const xdgCfg = process.env.XDG_CONFIG_HOME;
          const xdgData = process.env.XDG_DATA_HOME;
          const cfgDirs = [path.join(h, '.config'), ...(xdgCfg && path.isAbsolute(xdgCfg) ? [xdgCfg] : [])];
          const dataDirs = [path.join(h, '.local', 'share'), ...(xdgData && path.isAbsolute(xdgData) ? [xdgData] : [])];
          return [
            ...cfgDirs.flatMap((d) => ['google-chrome', 'chromium', 'BraveSoftware', '1Password'].map((n) => path.join(d, n))),
            ...dataDirs.map((d) => path.join(d, 'keyrings')),
            path.join(h, '.mozilla'), path.join(h, '.password-store'),
            path.join(h, '.var', 'app'), path.join(h, 'snap'),
            '/etc/shadow', '/etc/gshadow', '/etc/sudoers', '/root',
          ];
        })()
      : []),
    ...['Library/Keychains', 'Library/Cookies', 'Library/Application Support/BraveSoftware', 'Library/Application Support/Google/Chrome', 'Library/Application Support/Firefox', 'Library/Application Support/com.apple.TCC', 'Library/Application Support/1Password', 'Library/Group Containers'].map((p) => path.join(h, p)),
  ];
};

const inside = (child: string, parent: string) => {
  // Windows paths are not case-sensitive.
  const r = process.platform === 'win32' ? path.relative(parent.toLowerCase(), child.toLowerCase()) : path.relative(parent, child);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

const real = async (p: string) => fs.realpath(p).catch(() => null);

/** Resolves a path the model asked for, following links, and checks it against the folders and the deny-list. */
export async function resolveAllowed(raw: string, { forWrite = false } = {}): Promise<string> {
  if (!db.data.mac.files) throw new Error(`Access to files is turned off. The user can turn it on in the ${OS_PANEL} panel.`);
  const input = raw.startsWith('~') ? path.join(HOME(), raw.slice(1)) : raw;
  if (!path.isAbsolute(input)) throw new Error(process.platform === 'win32' ? 'Use a full path, starting with a drive letter (C:\\) or ~.' : 'Use a full path, starting with / or ~.');
  const abs = path.resolve(input);
  // A path that doesn't exist yet is judged by its nearest existing folder; links in either are followed.
  // The checks below come before any "does not exist" answer, so nothing outside the folders can be probed.
  const existing = await real(abs);
  let resolved = existing;
  if (!resolved) {
    let up = path.dirname(abs);
    while (!(await real(up)) && up !== path.dirname(up)) up = path.dirname(up);
    resolved = path.join((await real(up)) ?? up, path.relative(up, abs));
  }
  // "Everything": any folder on the computer, but the deny-list below still holds.
  if (!db.data.mac.everything) {
    const folders = (await Promise.all(db.data.mac.folders.map(real))).filter((f): f is string => Boolean(f));
    if (!folders.some((f) => inside(resolved!, f))) throw new Error(`That is outside the folders Duet may use: ${db.data.mac.folders.join(', ') || '(none added yet)'}.`);
  }
  const blocked = await Promise.all(sensitive().map(async (s) => (await real(s)) ?? s));
  if (blocked.some((s) => inside(resolved!, s))) throw new Error('That location holds passwords or keys, so Duet may not open it.');
  // Same rule as the workspace edit permissions: a protected name at any depth inside the workspace.
  const ws = (await real(WORKSPACE)) ?? WORKSPACE;
  // macOS and Windows file systems ignore case: so does this check.
  const fold = (s: string) => (process.platform === 'linux' ? s : s.toLowerCase());
  if (inside(resolved, ws) && path.relative(ws, resolved).split(path.sep).some((part) => PROTECTED.map(fold).includes(fold(part)))) throw new Error("That is one of Duet's own configuration files, so Duet may not open it.");
  if (!existing && !forWrite) throw new Error(`${raw} does not exist.`);
  return resolved;
}

const MAX_READ = 200_000;

export async function listFolder(p: string): Promise<string> {
  const dir = await resolveAllowed(p);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const lines = await Promise.all(
    entries.slice(0, 500).map(async (e) => {
      const st = await fs.stat(path.join(dir, e.name)).catch(() => null);
      return `${e.isDirectory() ? 'dir ' : 'file'}  ${e.name}${e.isDirectory() || !st ? '' : `  (${st.size} bytes)`}`;
    }),
  );
  return `${dir}\n${lines.join('\n') || '(empty)'}${entries.length > 500 ? `\n… ${entries.length - 500} more` : ''}`;
}

export async function readText(p: string): Promise<string> {
  const file = await resolveAllowed(p);
  const st = await fs.stat(file);
  if (st.isDirectory()) throw new Error('That is a folder. Use files_list.');
  if (/\.pdf$/i.test(file)) return readPdf(file, st.size);
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, MAX_READ));
    await fh.read(buf, 0, buf.length, 0);
    if (buf.includes(0)) throw new Error('That is not a text file.');
    return buf.toString('utf8') + (st.size > MAX_READ ? `\n… (cut at ${MAX_READ} of ${st.size} bytes)` : '');
  } finally {
    await fh.close();
  }
}

/** Extract plain text from a PDF. Scanned image-only PDFs have nothing to extract. */
async function readPdf(file: string, size: number): Promise<string> {
  if (size > 40_000_000) throw new Error('That PDF is too large to read (40 MB at most).');
  const data = new Uint8Array(await fs.readFile(file));
  // Lazy load: pdfjs is large and only needed for PDFs.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    const maxPages = Math.min(doc.numPages, 40);
    const parts: string[] = [];
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const line = content.items
        .map((it) => ('str' in it ? String((it as { str: string }).str) : ''))
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
      if (line) parts.push(line);
      if (parts.join('\n').length >= MAX_READ) break;
    }
    let text = parts.join('\n').slice(0, MAX_READ);
    if (!text.trim()) throw new Error('That PDF has no extractable text (it may be scanned images only).');
    const more = doc.numPages > maxPages ? `\n… (${doc.numPages - maxPages} more pages not shown)` : '';
    const cut = text.length >= MAX_READ ? `\n… (cut at ${MAX_READ} characters)` : '';
    return text + more + cut;
  } finally {
    await doc.destroy();
  }
}

/**
 * File-name and content search. shortcut: plain substring, first 20000 entries, files under 1 MB.
 * With "everything" on and no folder given, it starts at the home folder: a whole disk is too big to walk.
 */
export async function searchFiles(query: string, within?: string): Promise<string> {
  if (!db.data.mac.files) throw new Error(`Access to files is turned off. The user can turn it on in the ${OS_PANEL} panel.`);
  const roots = within ? [await resolveAllowed(within)] : db.data.mac.everything ? [HOME()] : (await Promise.all(db.data.mac.folders.map(real))).filter((f): f is string => Boolean(f));
  const blocked = await Promise.all(sensitive().map(async (s) => (await real(s)) ?? s));
  const q = query.toLowerCase();
  const hits: string[] = [];
  let seen = 0;
  // System and cache trees: huge, and never what the user means.
  const SKIP = new Set(['node_modules', '.git', '.Trash', 'Library', 'AppData', '$Recycle.Bin', 'System Volume Information', 'Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', '.cache']);
  const walk = async (dir: string): Promise<void> => {
    if (hits.length >= 40 || seen > 20_000 || blocked.some((b) => inside(dir, b))) return;
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (hits.length >= 40 || ++seen > 20_000) return;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) await walk(full);
        continue;
      }
      if (e.name.toLowerCase().includes(q)) {
        hits.push(`${full}  (name)`);
        continue;
      }
      const st = await fs.stat(full).catch(() => null);
      if (!st || st.size > 1_000_000) continue;
      const text = await fs.readFile(full, 'utf8').catch(() => '');
      const i = text.includes('\0') ? -1 : text.toLowerCase().indexOf(q);
      if (i >= 0) hits.push(`${full}  …${text.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' ')}…`);
    }
  };
  for (const r of roots) await walk(r);
  return hits.length ? hits.join('\n') : 'Nothing found.';
}

export async function writeText(p: string, content: string): Promise<string> {
  const file = await resolveAllowed(p, { forWrite: true });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  return `Wrote ${content.length} characters to ${file}.`;
}
