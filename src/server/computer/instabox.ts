import { randomUUID } from 'node:crypto';

/** What Instabox answered, in words the user can act on. Never contains the API key. */
export class InstaboxError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export interface InstaboxMachine {
  id: string;
  name: string;
  state: string;
  desiredState?: string;
  vault?: boolean;
  guestUser?: string;
  template?: { id: string };
  spec?: { vcpus: number; memMiB: number };
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
  truncated?: boolean;
}

interface Operation {
  id: string;
  state: string;
  error?: { code?: string; message?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Instabox's REST API (api.instabox.sh). The key is held in this object only. */
export class Instabox {
  constructor(
    private readonly key: string,
    private readonly base = process.env.INSTABOX_API_URL ?? 'https://api.instabox.sh',
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, o: { body?: unknown; query?: Record<string, string>; idempotent?: boolean; timeoutMs?: number } = {}): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { 'X-API-Key': this.key, Accept: 'application/json', 'User-Agent': 'openduet' };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    // One key per logical call, so a retry replays instead of acting twice.
    if (o.idempotent) headers['Idempotency-Key'] = randomUUID();
    const retriable = method === 'GET' || o.idempotent;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.doFetch(url, {
          method,
          headers,
          body: o.body === undefined ? undefined : JSON.stringify(o.body),
          signal: AbortSignal.timeout(o.timeoutMs ?? 60_000),
        });
      } catch (e) {
        if (retriable && attempt < 2) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        const timedOut = (e as Error).name === 'TimeoutError';
        throw new InstaboxError(
          timedOut ? 'Instabox took too long to answer.' : "Can't reach Instabox. Check this computer's internet connection.",
          0,
          timedOut ? 'timeout' : 'network_error',
        );
      }
      if (retriable && [502, 503, 504].includes(res.status) && attempt < 2) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      let json: any;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      if (!res.ok) throw describe(res.status, json?.error, text);
      return (json ?? {}) as T;
    }
  }

  me = () => this.request<{ login?: string; name?: string; orgId?: string }>('GET', '/v1/me');

  async listMachines(): Promise<InstaboxMachine[]> {
    const r = await this.request<{ machines?: InstaboxMachine[] }>('GET', '/v1/machines', { query: { limit: '100' } });
    return r.machines ?? [];
  }

  getMachine = (id: string) => this.request<InstaboxMachine>('GET', `/v1/machines/${encodeURIComponent(id)}`);

  /** Starts or resumes a machine and waits for the operation to finish. */
  async power(id: string, action: 'start' | 'resume', timeoutSeconds = 240): Promise<void> {
    const op = await this.request<Operation>('POST', `/v1/machines/${encodeURIComponent(id)}/${action}`, { idempotent: true });
    await this.waitForOperation(op.id, timeoutSeconds);
  }

  private async waitForOperation(id: string, timeoutSeconds: number): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new InstaboxError('The computer is taking too long to wake up. Try again in a minute.', 0, 'operation_timeout');
      const waitS = Math.max(1, Math.min(25, Math.floor(remaining / 1000)));
      const op = await this.request<Operation>('GET', `/v1/operations/${encodeURIComponent(id)}`, { query: { wait: `${waitS}s` }, timeoutMs: (waitS + 15) * 1000 });
      if (op.state === 'succeeded') return;
      if (op.state === 'failed') throw new InstaboxError(op.error?.message ?? 'The computer could not start.', 409, op.error?.code ?? 'operation_failed');
    }
  }

  /** Runs a command. `argv` runs without a shell (no quoting problems); `cmd` runs through bash -lc. */
  exec(id: string, o: { cmd?: string; argv?: string[]; cwd?: string; envs?: Record<string, string>; stdin?: string; timeoutSeconds?: number }): Promise<ExecResult> {
    const timeoutSeconds = o.timeoutSeconds ?? 60;
    return this.request<ExecResult>('POST', `/v1/machines/${encodeURIComponent(id)}/exec`, {
      body: { ...o, timeoutSeconds },
      timeoutMs: (timeoutSeconds + 30) * 1000,
    });
  }

  async readFile(id: string, path: string): Promise<{ type?: string; content?: string; binary?: boolean; entries?: unknown[] }> {
    return this.request('GET', `/v1/machines/${encodeURIComponent(id)}/files`, { query: { path } });
  }

  /** There is no write endpoint: content goes over exec as base64 on stdin (about 700 KB at most). */
  async writeFile(id: string, path: string, content: string): Promise<number> {
    const b64 = Buffer.from(content, 'utf8').toString('base64');
    if (b64.length > 1_048_000) throw new InstaboxError('That file is too large to write (about 700 KB at most).', 400, 'too_large');
    const r = await this.exec(id, {
      cmd: 'set -e; mkdir -p -- "$(dirname -- "$DUET_PATH")"; base64 -d > "$DUET_PATH"; wc -c < "$DUET_PATH"',
      stdin: b64,
      envs: { DUET_PATH: path },
      timeoutSeconds: 60,
    });
    if (r.exitCode !== 0) throw new InstaboxError(`Writing ${path} failed: ${firstLine(r.stderr)}`, 500, 'write_failed');
    return Number(r.stdout.trim()) || 0;
  }
}

const firstLine = (s: string) => s.trim().split('\n')[0].slice(0, 200);

function describe(status: number, error: { code?: string; message?: string; requestId?: string } | undefined, raw: string): InstaboxError {
  const code = error?.code ?? `http_${status}`;
  const detail = error?.message ?? (raw.slice(0, 200) || `HTTP ${status}`);
  const message =
    status === 401 || status === 403
      ? "Instabox didn't accept that API key. Create one in the Instabox dashboard and paste it again."
      : status === 404
        ? 'Instabox could not find that machine. It may have been deleted.'
        : status === 409 && code === 'machine_not_running'
          ? 'The computer is switched off. Start it from the Duet computer panel.'
          : status === 429
            ? 'Instabox is rate limiting requests. Try again in a minute.'
            : detail;
  return new InstaboxError(error?.requestId ? `${message} (request ${error.requestId})` : message, status, code, error?.requestId);
}
