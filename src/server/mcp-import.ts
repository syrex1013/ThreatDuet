import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { addConnector } from './connectors.js';

export interface ImportedServer {
  name: string;
  command?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface FoundServer {
  /** `claude:name` or `codex:name`; the import route reads the file again by this key. */
  key: string;
  source: 'Claude' | 'Codex';
  name: string;
  /** What will run or be called. Secrets are never included. */
  line: string;
  envKeys: string[];
}

const strMap = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const out = Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string' || typeof x === 'number').map(([k, x]) => [k, String(x)]));
  return Object.keys(out).length ? out : undefined;
};

function fromEntry(name: string, e: any): ImportedServer | null {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.command === 'string' && e.command.trim()) {
    const args = Array.isArray(e.args) ? e.args.map(String) : [];
    return { name, command: [e.command.trim(), ...args], env: strMap(e.env) };
  }
  if (typeof e.url === 'string') return { name, url: e.url, headers: strMap(e.headers ?? e.http_headers) };
  return null;
}

/** Claude/Cursor `.mcp.json` (mcpServers, or a bare map) or Codex `config.toml` ([mcp_servers.*]). */
export function parseMcpConfig(text: string): ImportedServer[] {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    try {
      data = parseToml(text);
    } catch {
      return [];
    }
  }
  const map = data?.mcpServers ?? data?.mcp_servers ?? data?.servers ?? data;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.entries(map)
    .map(([name, e]) => fromEntry(name, e))
    .filter((s): s is ImportedServer => Boolean(s));
}

const SOURCES: { source: FoundServer['source']; prefix: string; file: (home: string) => string }[] = [
  { source: 'Claude', prefix: 'claude', file: (h) => path.join(h, '.claude.json') },
  { source: 'Codex', prefix: 'codex', file: (h) => path.join(h, '.codex', 'config.toml') },
];

async function readSource(s: (typeof SOURCES)[number], home: string): Promise<ImportedServer[]> {
  const text = await fs.readFile(s.file(home), 'utf8').catch(() => '');
  return text ? parseMcpConfig(text) : [];
}

export async function discoverMcp(home = os.homedir()): Promise<FoundServer[]> {
  const out: FoundServer[] = [];
  for (const s of SOURCES)
    for (const e of await readSource(s, home))
      out.push({ key: `${s.prefix}:${e.name}`, source: s.source, name: e.name, line: e.command ? e.command.join(' ').slice(0, 300) : (e.url ?? ''), envKeys: Object.keys(e.env ?? {}) });
  return out;
}

export async function findByKeys(keys: string[], home = os.homedir()): Promise<ImportedServer[]> {
  const out: ImportedServer[] = [];
  for (const s of SOURCES) {
    const wanted = new Set(keys.filter((k) => k.startsWith(`${s.prefix}:`)).map((k) => k.slice(s.prefix.length + 1)));
    if (wanted.size) out.push(...(await readSource(s, home)).filter((e) => wanted.has(e.name)));
  }
  return out;
}

export async function importServers(list: ImportedServer[], confirmed: boolean): Promise<{ added: number; errors: string[] }> {
  let added = 0;
  const errors: string[] = [];
  for (const e of list) {
    const r = await addConnector({ name: e.name, url: e.url, headers: e.headers, command: e.command, env: e.env, confirmed });
    if ('error' in r) errors.push(`${e.name}: ${r.error}`);
    else added++;
  }
  return { added, errors };
}
