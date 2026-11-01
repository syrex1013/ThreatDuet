import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execa, execaSync, type ResultPromise } from 'execa';
import { CONNECTORS_FILE, RUN_TIMEOUT_MS, WORKSPACE, log } from './config.js';
import { kiloEnv } from './connectors.js';
import type { KiloRun } from './kilo.js';
import { parseKiloEvents, type KiloResult } from './parse.js';

/**
 * Talks to a headless `kilo serve` over HTTP instead of starting `kilo run` for every turn. The prompt
 * travels in the request body (no command line, so no length or line-break limits on Windows), progress
 * comes from the event stream, and one server stays warm between turns.
 */
interface Server {
  base: string;
  auth: string;
  proc: ResultPromise;
}

let server: Server | null = null;
let starting: Promise<Server> | null = null;
let pending: ResultPromise | null = null;
let applied = '';

/** The server could not be started: callers fall back to the CLI. */
export class KiloServerError extends Error {}

const posix = process.platform !== 'win32';

async function start(): Promise<Server> {
  const password = randomBytes(24).toString('base64url');
  const proc = execa('kilo', ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
    cwd: WORKSPACE,
    env: { ...kiloEnv(), KILO_SERVER_PASSWORD: password, KILO_SERVER_USERNAME: 'kilo' },
    stdin: 'ignore',
    reject: false,
    detached: posix,
    buffer: false,
  });
  pending = proc;
  const base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new KiloServerError('kilo serve did not start in 30 seconds')), 30_000);
    let seen = '';
    proc.stdout?.on('data', (c: Buffer) => {
      seen += c.toString();
      const m = seen.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    void proc.then((r) => {
      clearTimeout(timer);
      reject(new KiloServerError(`kilo serve exited (${r.exitCode ?? r.signal ?? 'unknown'}) before it was ready`));
    });
  }).catch((e) => {
    killTree(proc.pid, 'SIGKILL');
    throw e instanceof KiloServerError ? e : new KiloServerError(String(e));
  }).finally(() => {
    if (pending === proc) pending = null;
  });
  const s: Server = { base, auth: `Basic ${Buffer.from(`kilo:${password}`).toString('base64')}`, proc };
  void proc.then(() => {
    if (server === s) server = null;
  });
  applied = '';
  log.info({ base }, 'kilo server started');
  return s;
}

function killTree(pid: number | undefined, sig: NodeJS.Signals): void {
  if (!pid) return;
  try {
    if (posix) process.kill(-pid, sig);
    else execaSync('taskkill', ['/pid', String(pid), '/T', '/F'], { reject: false });
  } catch {
    /* already gone */
  }
}

export function stopKiloServer(): void {
  const s = server;
  server = null;
  if (s) killTree(s.proc.pid, 'SIGKILL');
  if (pending) killTree(pending.pid, 'SIGKILL');
}
process.once('exit', stopKiloServer);

async function ensure(): Promise<Server> {
  if (server) return server;
  starting ??= start()
    .then((s) => (server = s))
    .finally(() => {
      starting = null;
    });
  return starting;
}

const headers = (s: Server) => ({ authorization: s.auth, 'content-type': 'application/json', 'x-opencode-directory': WORKSPACE });
const url = (s: Server, p: string) => `${s.base}${p}${p.includes('?') ? '&' : '?'}directory=${encodeURIComponent(WORKSPACE)}`;

async function call<T>(s: Server, method: string, p: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url(s, p), { method, headers: headers(s), body: body === undefined ? undefined : JSON.stringify(body), signal });
  if (!r.ok) throw new Error(`kilo server answered ${r.status} for ${method} ${p}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return (await r.json()) as T;
}

/** The server reads its config once. When the permissions, apps or skills changed, it is told to reload. */
async function syncConfig(s: Server): Promise<void> {
  const read = (f: string) => fs.readFile(f, 'utf8').catch(() => '');
  const skills = await fs.readdir(path.join(WORKSPACE, '.kilo', 'skills')).catch(() => [] as string[]);
  const stamp = [await read(path.join(WORKSPACE, 'kilo.json')), await read(CONNECTORS_FILE), skills.sort().join(',')].join('\u0000');
  if (stamp === applied) return;
  if (applied) {
    // A reload that didn't happen would leave the old permissions in force: restart the server, or use the CLI.
    const r = await fetch(`${s.base}/global/dispose`, { method: 'POST', headers: headers(s) }).catch(() => null);
    if (!r?.ok) {
      stopKiloServer();
      throw new KiloServerError('kilo server could not reload its settings');
    }
  }
  applied = stamp;
}

export interface Part {
  type: string;
  text?: string;
  tool?: string;
  state?: { status?: string; input?: Record<string, unknown>; title?: string };
}

/** Same shape the CLI prints with `--format json`, so one parser serves both. */
export const asEvents = (sessionID: string, parts: Part[], error: unknown): string =>
  [
    ...parts.map((part) => JSON.stringify(part.type === 'step-start' ? { type: 'step_start', sessionID } : { type: part.type, sessionID, part })),
    ...(error ? [JSON.stringify({ type: 'error', sessionID, error })] : []),
  ].join('\n');

/** Streams the session's events: progress phrases for the UI, and an answer to any permission question. */
function watch(s: Server, sessionID: string, run: KiloRun, describe: (tool: string, input: Record<string, unknown>) => string, signal: AbortSignal): void {
  void (async () => {
    const r = await fetch(url(s, '/event'), { headers: headers(s), signal }).catch(() => null);
    if (!r?.body) return;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let e: { type?: string; properties?: any };
        try {
          e = JSON.parse(line.slice(5));
        } catch {
          continue;
        }
        const p = e.properties ?? {};
        if (e.type === 'message.part.updated' && p.part?.sessionID === sessionID) {
          const part = p.part as Part;
          if (part.type === 'tool' && part.state?.status !== 'completed' && part.state?.status !== 'error') run.onProgress?.(describe(part.tool ?? '', part.state?.input ?? {}));
          else if (part.type === 'text') run.onProgress?.('writing a reply');
        } else if ((e.type === 'permission.asked' || e.type === 'permission.updated') && p.sessionID === sessionID && (p.id ?? p.requestID)) {
          // Only a user-approved task may auto-approve; anything else is refused.
          await call(s, 'POST', `/permission/${p.id ?? p.requestID}/reply`, { reply: run.auto ? 'once' : 'reject' }).catch(() => undefined);
        }
      }
    }
  })();
}

export async function runKiloApi(run: KiloRun, describe: (tool: string, input: Record<string, unknown>) => string): Promise<KiloResult> {
  const s = await ensure();
  await syncConfig(s);
  const slash = run.model.indexOf('/');
  const model = { providerID: run.model.slice(0, slash), modelID: run.model.slice(slash + 1) };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), RUN_TIMEOUT_MS);
  let sessionID = '';
  try {
    if (run.session) {
      const known = await call<{ id: string }>(s, 'GET', `/session/${run.session}`).catch(() => null);
      if (known) sessionID = known.id;
    }
    if (!sessionID) sessionID = (await call<{ id: string }>(s, 'POST', '/session', {})).id;
    watch(s, sessionID, run, describe, ctl.signal);
    const done = await call<{ info?: { error?: unknown }; parts?: Part[] }>(s, 'POST', `/session/${sessionID}/message`, { agent: run.agent, model, parts: [{ type: 'text', text: run.prompt }] }, ctl.signal);
    // The answer to the POST is only the last step; the tool calls of earlier steps are in the session.
    let parts = done.parts ?? [];
    const all = await call<{ info: { id: string; role: string }; parts: Part[] }[]>(s, 'GET', `/session/${sessionID}/message`).catch(() => null);
    const parent = (done.info as { parentID?: string } | undefined)?.parentID;
    const from = all && parent ? all.findIndex((m) => m.info.id === parent) : -1;
    if (all && from >= 0) parts = all.slice(from + 1).filter((m) => m.info.role === 'assistant').flatMap((m) => m.parts);
    const result = parseKiloEvents(asEvents(sessionID, parts, done.info?.error));
    result.sessionID = sessionID;
    return result;
  } catch (e) {
    if (ctl.signal.aborted && sessionID) await call(s, 'POST', `/session/${sessionID}/abort`, {}).catch(() => undefined);
    const msg = ctl.signal.aborted ? 'kilo timed out' : e instanceof Error ? e.message : String(e);
    return { sessionID: sessionID || null, text: '', finalText: '', tools: [], errors: [msg] };
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
}

