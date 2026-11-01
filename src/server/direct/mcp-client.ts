import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { execa } from 'execa';
import type { ConnectorState } from '../../shared/types.js';
import { DATA_DIR, log } from '../config.js';
import type { ConnectorRecord } from '../connectors.js';
import { db } from '../store.js';

/** One tool Duet can call: its model-facing name, schema, and how to run it. */
export interface Tool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  call: (args: Record<string, unknown>) => Promise<string>;
}

export interface Handle {
  tools: Tool[];
  close: () => Promise<void>;
}

const OAUTH_DIR = path.join(DATA_DIR, 'mcp-oauth');
/** Fixed, because the address is registered with each service when the app first signs in. */
const CALLBACK_PORT = 19877;
const REDIRECT = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

/** OAuth for one remote server. Tokens live in the private data folder, never in the workspace. */
class Auth implements OAuthClientProvider {
  authUrl: string | null = null;
  private verifier = '';
  constructor(private readonly id: string) {}
  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata() {
    return { client_name: 'OpenDuet', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }
  private file = () => path.join(OAUTH_DIR, `${this.id}.json`);
  private async read(): Promise<Record<string, any>> {
    return JSON.parse(await fs.readFile(this.file(), 'utf8').catch(() => '{}'));
  }
  private async write(patch: Record<string, unknown>) {
    await fs.mkdir(OAUTH_DIR, { recursive: true, mode: 0o700 });
    await fs.writeFile(this.file(), JSON.stringify({ ...(await this.read()), ...patch }), { mode: 0o600 });
  }
  async clientInformation() {
    return (await this.read()).client;
  }
  async saveClientInformation(client: any) {
    await this.write({ client });
  }
  async tokens() {
    return (await this.read()).tokens;
  }
  async saveTokens(tokens: any) {
    await this.write({ tokens });
  }
  redirectToAuthorization(url: URL) {
    this.authUrl = url.toString();
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
  async forget() {
    await fs.rm(this.file(), { force: true });
  }
}

const auths = new Map<string, Auth>();
const authFor = (id: string) => auths.get(id) ?? auths.set(id, new Auth(id)).get(id)!;

interface Conn {
  client: Client;
  transport: Transport;
  tools: { name: string; description?: string; inputSchema: Record<string, unknown> }[];
}
const conns = new Map<string, Conn>();
/** A slow first connect (npx downloading a package) is shared, not started again by every run and status poll. */
const pending = new Map<string, Promise<Conn>>();

function transportFor(c: ConnectorRecord, kind: 'http' | 'sse'): Transport {
  if (c.command) return new StdioClientTransport({ command: c.command[0], args: c.command.slice(1), env: { ...(process.env as Record<string, string>), ...(c.env ?? {}) }, stderr: 'ignore' });
  const opts = { requestInit: { headers: c.headers ?? {} }, authProvider: authFor(c.id) };
  return kind === 'http' ? new StreamableHTTPClientTransport(new URL(c.url), opts) : new SSEClientTransport(new URL(c.url), opts);
}

function connect(c: ConnectorRecord): Promise<Conn> {
  const have = conns.get(c.id);
  if (have) return Promise.resolve(have);
  let p = pending.get(c.id);
  if (!p) {
    const mine: Promise<Conn> = doConnect(c)
      .then(async (conn) => {
        // Dropped, signed out or changed while connecting: this client was built from the old settings.
        if (pending.get(c.id) !== mine) {
          await conn.client.close().catch(() => undefined);
          throw new Error('The app changed while connecting. Try again.');
        }
        const prev = conns.get(c.id);
        conns.set(c.id, conn);
        if (prev) await prev.client.close().catch(() => undefined);
        return conn;
      })
      .finally(() => {
        if (pending.get(c.id) === mine) pending.delete(c.id);
      });
    p = mine;
    pending.set(c.id, p);
  }
  return p;
}

async function doConnect(c: ConnectorRecord): Promise<Conn> {
  let lastError: unknown;
  for (const kind of c.command ? (['http'] as const) : (['http', 'sse'] as const)) {
    const transport = transportFor(c, kind);
    const client = new Client({ name: 'openduet', version: '1.0.0' });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      return { client, transport, tools: listed.tools as Conn['tools'] };
    } catch (e) {
      lastError = e;
      await client.close().catch(() => undefined);
      if (e instanceof UnauthorizedError) throw e;
    }
  }
  throw lastError;
}

/** Closes every app connection: settings or apps changed, so the next use connects afresh. */
export async function dropConnections(): Promise<void> {
  const all = [...conns.values()];
  conns.clear();
  pending.clear();
  await Promise.all(all.map((c) => c.client.close().catch(() => undefined)));
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
const textOf = (r: any): string => {
  const parts = (r?.content ?? []) as { type: string; text?: string }[];
  const out = parts.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n');
  return (r?.isError ? 'ERROR: ' : '') + out;
};

function toolsOf(prefix: string, tools: Conn['tools'], client: Client): Tool[] {
  return tools.map((t) => ({
    name: `${prefix}_${safe(t.name)}`.slice(0, 64),
    description: (t.description ?? '').slice(0, 1000),
    schema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    call: async (args) => textOf(await client.callTool({ name: t.name, arguments: args }, undefined, { timeout: 120_000 })),
  }));
}

/** Tools of every enabled app, plus Duet's own Mac and cloud-computer tools. Failures are skipped, not fatal. */
export async function openTools(): Promise<Handle> {
  const tools: Tool[] = [];
  const closers: (() => Promise<void>)[] = [];
  const inMemory = async (prefix: string, build: () => import('@modelcontextprotocol/sdk/server/mcp.js').McpServer) => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await build().connect(b);
    const client = new Client({ name: 'openduet', version: '1.0.0' });
    await client.connect(a);
    closers.push(() => client.close());
    tools.push(...toolsOf(prefix, (await client.listTools()).tools as Conn['tools'], client));
  };
  const { macOn } = await import('../store.js');
  if (macOn()) await inMemory('mac', (await import('../mac/mcp.js')).buildMacServer).catch((e) => log.warn({ err: String(e) }, 'mac tools unavailable'));
  if (db.data.computer) await inMemory('computer', (await import('../computer/mcp.js')).buildComputerServer).catch((e) => log.warn({ err: String(e) }, 'computer tools unavailable'));
  await Promise.all(
    db.data.connectors
      .filter((c) => c.enabled)
      .map(async (c) => {
        try {
          const conn = await withTimeout(connect(c), 30_000);
          tools.push(...toolsOf(c.id, conn.tools, conn.client));
        } catch (e) {
          log.warn({ app: c.id, err: e instanceof UnauthorizedError ? 'needs sign-in' : String(e).slice(0, 120) }, 'app unavailable');
        }
      }),
  );
  return { tools, close: async () => void (await Promise.all(closers.map((f) => f().catch(() => undefined)))) };
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);

export async function connectorStatuses(): Promise<Record<string, { state: ConnectorState; detail: string | null }>> {
  const out: Record<string, { state: ConnectorState; detail: string | null }> = {};
  await Promise.all(
    db.data.connectors.map(async (c) => {
      if (!c.enabled) return void (out[c.id] = { state: 'off', detail: null });
      try {
        await withTimeout(connect(c), 30_000);
        out[c.id] = { state: 'connected', detail: null };
      } catch (e) {
        out[c.id] = e instanceof UnauthorizedError ? { state: 'needs-sign-in', detail: null } : { state: 'error', detail: String((e as Error).message ?? e).replace(/https?:\/\/\S+/g, '(address hidden)').slice(0, 200) };
      }
    }),
  );
  return out;
}

export async function directLogout(id: string): Promise<void> {
  const c = conns.get(id);
  conns.delete(id);
  pending.delete(id);
  await c?.client.close().catch(() => undefined);
  await authFor(id).forget();
  auths.delete(id);
}

const openBrowser = (url: string) =>
  process.platform === 'darwin' ? execa('open', [url], { reject: false }) : process.platform === 'win32' ? execa('rundll32', ['url.dll,FileProtocolHandler', url], { reject: false }) : execa('xdg-open', [url], { reject: false });

/**
 * Browser sign-in for a remote app: the same flow Kilo runs, with the page opened here and the answer caught
 * on a loopback port. Resolves true when the app is connected. `onUrl` gets the page in case it didn't open.
 */
export async function directSignIn(c: ConnectorRecord, onUrl: (url: string) => void, signal: AbortSignal): Promise<boolean> {
  if (c.command) return false;
  conns.delete(c.id);
  pending.delete(c.id);
  const auth = authFor(c.id);
  auth.authUrl = null;
  const transport = new StreamableHTTPClientTransport(new URL(c.url), { requestInit: { headers: c.headers ?? {} }, authProvider: auth });
  const client = new Client({ name: 'openduet', version: '1.0.0' });
  try {
    await client.connect(transport);
    return true; // already signed in
  } catch (e) {
    if (!(e instanceof UnauthorizedError) || !auth.authUrl) return false;
  }
  onUrl(auth.authUrl);
  void openBrowser(auth.authUrl);
  const code = await new Promise<string | null>((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', REDIRECT);
      if (u.pathname !== '/callback') return void res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'text/html' }).end('<p style="font:16px system-ui;margin:3rem">Signed in. You can close this tab and go back to OpenDuet.</p>');
      done(u.searchParams.get('code'));
    });
    const done = (v: string | null) => {
      srv.close();
      resolve(v);
    };
    signal.addEventListener('abort', () => done(null));
    srv.on('error', () => done(null));
    srv.listen(CALLBACK_PORT, '127.0.0.1');
  });
  if (!code) return false;
  try {
    await transport.finishAuth(code);
    const fresh = new Client({ name: 'openduet', version: '1.0.0' });
    await fresh.connect(new StreamableHTTPClientTransport(new URL(c.url), { requestInit: { headers: c.headers ?? {} }, authProvider: auth }));
    await fresh.close();
    return true;
  } catch (e) {
    log.warn({ app: c.id, err: String(e).slice(0, 160) }, 'sign-in did not finish');
    return false;
  } finally {
    await client.close().catch(() => undefined);
  }
}
