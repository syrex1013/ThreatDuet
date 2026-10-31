import { execa } from 'execa';
import { buildInstall, type McpField, type McpListing, type McpPlan, type McpSearch } from '../shared/market.js';
import { addConnector } from './connectors.js';

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers';

interface Arg {
  type?: string;
  name?: string;
  value?: string;
  valueHint?: string;
  default?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}
interface RegistryServer {
  name: string;
  title?: string;
  description?: string;
  repository?: { url?: string };
  remotes?: { type: string; url: string; headers?: (Arg & { name: string })[] }[];
  packages?: {
    registryType: string;
    identifier: string;
    version?: string;
    runtimeHint?: string;
    transport?: { type?: string };
    runtimeArguments?: Arg[];
    packageArguments?: Arg[];
    environmentVariables?: (Arg & { name: string })[];
  }[];
}

const hasVar = (s: string | undefined) => /\{[^}]*\}/.test(s ?? '');
const label = (a: Arg, fallback: string) => (a.description || a.valueHint || fallback).slice(0, 120);

/** Registry entry to something installable, or null for anything we can't run safely or at all. */
export function planFor(s: RegistryServer): McpPlan | null {
  for (const r of s.remotes ?? []) {
    if ((r.type !== 'streamable-http' && r.type !== 'sse') || hasVar(r.url) || !/^https:\/\//.test(r.url)) continue;
    const fields: McpField[] = [];
    const staticHeaders: Record<string, string> = {};
    let ok = true;
    for (const h of r.headers ?? []) {
      const vars = (h.value ?? '').match(/\{[^}]*\}/g) ?? [];
      if (vars.length > 1) ok = false;
      else if (h.value && !vars.length) staticHeaders[h.name] = h.value;
      else fields.push({ key: h.name, kind: 'header', label: label(h, h.name), secret: Boolean(h.isSecret), required: Boolean(h.isRequired), template: h.value ? h.value.replace(/\{[^}]*\}/, '{}') : '{}' });
    }
    if (ok) return { type: 'remote', url: r.url, staticHeaders, fields };
  }

  for (const p of s.packages ?? []) {
    if (p.transport?.type && p.transport.type !== 'stdio') continue;
    const fields: McpField[] = [];
    const staticEnv: Record<string, string> = {};
    const argv: Extract<McpPlan, { type: 'local' }>['argv'] = [];
    const version = p.version && p.version !== 'latest' ? p.version : '';
    let head: string[];
    if (p.registryType === 'npm') head = [p.runtimeHint || 'npx', ...(p.runtimeArguments ?? []).flatMap((a) => (a.value && !hasVar(a.value) ? [a.value] : [])), version ? `${p.identifier}@${version}` : p.identifier];
    else if (p.registryType === 'pypi') head = [p.runtimeHint || 'uvx', version ? `${p.identifier}==${version}` : p.identifier];
    else if (p.registryType === 'oci') head = ['docker', 'run', '-i', '--rm'];
    else continue;
    if (head[0] === 'npx' && !head.includes('-y')) head.splice(1, 0, '-y');
    if (!['npx', 'uvx', 'docker'].includes(head[0])) continue;
    argv.push(...head);

    let ok = true;
    for (const e of p.environmentVariables ?? []) {
      if (hasVar(e.value) || hasVar(e.default)) ok = false;
      else if (e.value) staticEnv[e.name] = e.value;
      else fields.push({ key: e.name, kind: 'env', label: `${e.name}: ${label(e, e.name)}`.slice(0, 140), secret: Boolean(e.isSecret), required: Boolean(e.isRequired), default: e.default });
    }
    // Docker only passes along the variables it is told about.
    if (p.registryType === 'oci') {
      for (const k of [...Object.keys(staticEnv), ...fields.filter((f) => f.kind === 'env').map((f) => f.key)]) argv.push('-e', k);
      argv.push(p.identifier);
    }
    (p.packageArguments ?? []).forEach((a, i) => {
      if (hasVar(a.value) || hasVar(a.default)) ok = false;
      else if (a.value) argv.push(...(a.type === 'named' && a.name ? [a.name, a.value] : [a.value]));
      else if (a.type === 'named' && a.name && !a.valueHint && !a.default) {
        if (a.isRequired) argv.push(a.name);
      } else if (a.isRequired || a.default) {
        const key = `arg${i}`;
        fields.push({ key, kind: 'arg', label: label(a, a.name ?? 'Value'), secret: Boolean(a.isSecret), required: Boolean(a.isRequired), default: a.default, flag: a.type === 'named' ? a.name : undefined });
        argv.push({ field: key });
      }
    });
    if (ok) return { type: 'local', argv, staticEnv, fields };
  }
  return null;
}

const listing = (s: RegistryServer): McpListing | null => {
  const plan = planFor(s);
  if (!plan) return null;
  return {
    name: s.name,
    title: s.title || s.name.split('/').pop() || s.name,
    description: (s.description ?? '').slice(0, 300),
    publisher: s.name.split('/')[0],
    repo: /^https:\/\//.test(s.repository?.url ?? '') ? (s.repository?.url ?? null) : null,
    plan,
  };
};

async function registry(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'user-agent': 'OpenDuet' }, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r) throw new Error("Can't reach the MCP Registry. Check your connection.");
  if (!r.ok) throw new Error(`The MCP Registry answered ${r.status}.`);
  return r.json();
}

export async function searchMcp(q: string, cursor?: string): Promise<McpSearch> {
  const u = new URL(REGISTRY);
  u.searchParams.set('version', 'latest');
  u.searchParams.set('limit', '20');
  if (q.trim()) u.searchParams.set('search', q.trim());
  if (cursor) u.searchParams.set('cursor', cursor);
  const body = await registry(u.toString());
  const servers = (body.servers ?? []).map((x: { server: RegistryServer }) => listing(x.server)).filter(Boolean) as McpListing[];
  return { servers, next: body.metadata?.nextCursor ?? null };
}

/** Installs one registry server. The entry is fetched again here: the UI never supplies the command. */
export async function installMcp(input: { name: string; values: Record<string, string>; confirmed: boolean }): Promise<{ id: string } | { error: string }> {
  let entry: McpListing | null;
  try {
    const body = await registry(`${REGISTRY}/${encodeURIComponent(input.name)}/versions/latest`);
    entry = listing(body.server);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (!entry) return { error: "This server can't be installed from here." };
  const built = buildInstall(entry.plan, input.values);
  if ('error' in built) return built;
  if (built.command) {
    const runner = built.command[0];
    const found = await execa(process.platform === 'win32' ? 'where' : 'which', [runner], { reject: false });
    if (found.exitCode !== 0) return { error: `This needs ${runner === 'npx' ? 'Node.js (npx)' : runner === 'uvx' ? 'uv (uvx)' : 'Docker'} installed on this computer.` };
  }
  const header = built.headers && Object.entries(built.headers).length ? built.headers : undefined;
  return addConnector({ name: entry.title, url: built.url, headers: header, command: built.command, env: built.env, confirmed: input.confirmed });
}
