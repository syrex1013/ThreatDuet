import fs from 'node:fs/promises';
import { OS_NAME } from './mac/os.js';
import { execa, execaSync, type ResultPromise } from 'execa';
import type { ConnectorInfo, ConnectorsResponse, ConnectorState } from '../shared/types.js';
import { CONNECTORS_FILE, log, WORKSPACE } from './config.js';
import { computerEndpoint, duetEndpoint, macEndpoint } from './computer/endpoint.js';
import { useDirect } from './direct/available.js';
import { connectorStatuses, directLogout, directSignIn, dropConnections } from './direct/mcp-client.js';
import { stateChanged } from './events.js';
import { db, macOn } from './store.js';
import { PRESETS } from '../shared/connectors.js';
import { tr } from './i18n.js';

/** A connected app as stored on this computer. `url` and `headers` may hold credentials. */
export interface ConnectorRecord {
  id: string;
  name: string;
  /** Empty for a program that runs on this computer (see `command`). */
  url: string;
  headers?: Record<string, string>;
  /** A program started by kilo: argv, never a shell. */
  command?: string[];
  env?: Record<string, string>;
  presetId: string | null;
  enabled: boolean;
  autoRead: boolean;
  addedAt: number;
}

/** Environment for every kilo call, so run, list, auth and logout all see the same apps. */
export const kiloEnv = () => ({ PWD: WORKSPACE, KILO_CONFIG: CONNECTORS_FILE });

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
const stripUrls = (s: string) => s.replace(/https?:\/\/\S+/g, '(address hidden)');

/** Kilo's MCP section, written to a 0600 file in the data folder. Never inside the workspace. */
export async function writeConnectorsConfig(): Promise<void> {
  const mcp = Object.fromEntries(
    db.data.connectors.map((c) => [
      c.id,
      c.command
        ? { type: 'local', command: c.command, ...(c.env && Object.keys(c.env).length ? { environment: c.env } : {}), enabled: c.enabled }
        : { type: 'remote', url: c.url, ...(c.headers && Object.keys(c.headers).length ? { headers: c.headers } : {}), enabled: c.enabled },
    ]),
  );
  // Duet's cloud computer is served by this very process, behind a token that changes on every start.
  const computer = computerEndpoint();
  if ((db.data.cloudBroker || db.data.computer) && computer) Object.assign(mcp, { computer: { type: 'remote', url: computer.url, headers: computer.headers, enabled: true } });
  const mac = macEndpoint();
  if (macOn() && mac) Object.assign(mcp, { local: { type: 'remote', url: mac.url, headers: mac.headers, enabled: true } });
  const meta = duetEndpoint();
  if (meta) Object.assign(mcp, { duet: { type: 'remote', url: meta.url, headers: meta.headers, enabled: true } });
  await fs.writeFile(CONNECTORS_FILE, JSON.stringify({ $schema: 'https://app.kilo.ai/config.json', mcp }, null, 2), { mode: 0o600 });
  await fs.chmod(CONNECTORS_FILE, 0o600);
  status = null;
  void dropConnections();
}

/**
 * Parses `kilo mcp list` into states. Only the first error line is kept, with addresses removed:
 * the following lines repeat the server URL, which can contain a secret.
 */
export function parseMcpList(output: string): Record<string, { state: ConnectorState; detail: string | null }> {
  const lines = stripAnsi(output).split('\n');
  const out: Record<string, { state: ConnectorState; detail: string | null }> = {};
  lines.forEach((line, i) => {
    const m = line.match(/^[\s●◆◇│]*([✓⚠○✗])\s+(\S+)\s*(.*)$/);
    if (!m) return;
    const [, mark, id] = m;
    const state: ConnectorState = mark === '✓' ? 'connected' : mark === '⚠' ? 'needs-sign-in' : mark === '○' ? 'off' : 'error';
    let detail: string | null = null;
    if (state === 'error') {
      const next = (lines[i + 1] ?? '').replace(/^[\s│]*/, '').trim();
      detail = next && !/^https?:\/\//.test(next) ? stripUrls(next).slice(0, 200) : null;
    }
    out[id] = { state, detail };
  });
  return out;
}

type StatusMap = Record<string, { state: ConnectorState; detail: string | null }>;
let status: StatusMap | null = null;
let statusAt = 0;
let statusRun: Promise<StatusMap> | null = null;

/** Status of every app, from kilo (which connects to each server). Cached for a minute. */
async function connectorStatus(force = false): Promise<StatusMap> {
  if (!force && status && Date.now() - statusAt < 60_000) return status;
  statusRun ??= (async () => {
    const parsed = (await useDirect())
      ? await connectorStatuses()
      : parseMcpList((await execa('kilo', ['mcp', 'list'], { cwd: WORKSPACE, env: kiloEnv(), reject: false, timeout: 90_000, stdin: 'ignore' })).stdout ?? '');
    status = parsed;
    statusAt = Date.now();
    return parsed;
  })().finally(() => {
    statusRun = null;
  });
  return statusRun;
}

const site = (c: ConnectorRecord) => {
  if (c.command) return c.command[0].split('/').pop() ?? 'program';
  try {
    return new URL(c.url).hostname;
  } catch {
    return 'unknown';
  }
};

let signIn: { id: string; url: string | null; proc: ResultPromise; abort?: AbortController; reason: 'cancel' | 'timeout' | null; timer: NodeJS.Timeout } | null = null;
let lastError: { id: string; message: string } | null = null;

export async function connectorsResponse(force = false): Promise<ConnectorsResponse> {
  const st = db.data.connectors.length ? await connectorStatus(force) : {};
  const connectors: ConnectorInfo[] = db.data.connectors.map((c) => {
    const s = st?.[c.id];
    const state: ConnectorState = signIn?.id === c.id ? 'signing-in' : !c.enabled ? 'off' : (s?.state ?? 'unknown');
    return { id: c.id, name: c.name, kind: c.command ? 'local' : 'remote', site: site(c), presetId: c.presetId, enabled: c.enabled, autoRead: c.autoRead, state, detail: s?.detail ?? null };
  });
  return { connectors, signIn: signIn && { id: signIn.id, url: signIn.url }, lastError, openWebPages: db.data.settings.openWebPages };
}

/** Lowercase letters and digits only, so `<id>_` tool prefixes can never overlap. */
export function connectorId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'app';
  let id = base;
  // "computer" and "mac" belong to Duet's own tools.
  for (let n = 2; id === 'computer' || id === 'mac' || id === 'local' || id === 'duet' || db.data.connectors.some((c) => c.id === id); n++) id = `${base}${n}`;
  return id;
}

/** Only https, except a server on this computer. */
export function checkUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.toString();
  } catch {
    /* fall through */
  }
  return null;
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export async function addConnector(input: {
  name: string;
  url?: string;
  headers?: Record<string, string>;
  header?: { name: string; value: string };
  command?: string[];
  env?: Record<string, string>;
  presetId?: string | null;
  /** The person saw the exact command and agreed to run it. Required for programs on this computer. */
  confirmed?: boolean;
}): Promise<{ id: string; warning?: string } | { error: string }> {
  const headers = { ...input.headers, ...(input.header?.name && input.header.value ? { [input.header.name]: input.header.value } : {}) };
  let url = '';
  if (input.command) {
    const cmd = input.command;
    if (!cmd.length || cmd.length > 40 || cmd.some((p) => !p || p.length > 500)) return { error: tr('The command is empty or too long.') };
    if (Object.keys(input.env ?? {}).some((k) => !ENV_NAME.test(k))) return { error: tr('An environment variable name is not valid.') };
    if (!input.confirmed) return { error: tr('Confirm that this program may run on your computer.') };
  } else {
    const checked = checkUrl(input.url ?? '');
    if (!checked) return { error: tr('Use an https:// address for the app.') };
    url = checked;
  }
  const record: ConnectorRecord = {
    id: connectorId(input.name),
    name: input.name.trim().slice(0, 60),
    url,
    headers: Object.keys(headers).length ? headers : undefined,
    command: input.command,
    env: input.command && Object.keys(input.env ?? {}).length ? input.env : undefined,
    presetId: input.presetId ?? null,
    enabled: true,
    autoRead: true,
    addedAt: Date.now(),
  };
  db.data.connectors.push(record);
  await db.write();
  await writeConnectorsConfig();
  let warning: string | undefined;
  const skillUrl = PRESETS.find((x) => x.id === record.presetId)?.skillUrl;
  if (skillUrl) {
    const skill = await (await import('./skills.js')).installSkill({ url: skillUrl }).catch((e) => ({ error: String(e) }));
    if ('error' in skill) {
      log.warn({ app: record.id, err: skill.error }, 'payment skill not installed');
      warning = tr('Connected, but the helper skill did not install: {err}', { err: skill.error });
    } else await (await import('./store.js')).writeWorkspaceConfig().catch(() => undefined);
  }
  return warning ? { id: record.id, warning } : { id: record.id };
}

export async function updateConnector(id: string, patch: { enabled?: boolean; autoRead?: boolean }) {
  const c = db.data.connectors.find((x) => x.id === id);
  if (!c) return false;
  Object.assign(c, patch);
  await db.write();
  await writeConnectorsConfig();
  return true;
}

/** Signs out (kilo deletes its stored tokens) and forgets the app. */
export async function removeConnector(id: string) {
  if (!db.data.connectors.some((c) => c.id === id)) return false;
  if (signIn?.id === id) cancelSignIn();
  if (await useDirect()) await directLogout(id);
  else await execa('kilo', ['mcp', 'logout', id], { cwd: WORKSPACE, env: kiloEnv(), reject: false, timeout: 30_000, stdin: 'ignore' });
  db.data.connectors = db.data.connectors.filter((c) => c.id !== id);
  await db.write();
  await writeConnectorsConfig();
  return true;
}

/**
 * Starts kilo's OAuth flow. Kilo opens the browser itself when it can and prints the page either way;
 * tokens land in kilo's own store, never in ThreatDuet's files. One at a time: the callback port is fixed.
 */
export async function startSignIn(id: string): Promise<{ ok: true } | { error: string }> {
  const c = db.data.connectors.find((x) => x.id === id);
  if (!c) return { error: tr('That app is not connected.') };
  if (signIn) return { error: tr('Finish or cancel the sign-in that is already open first.') };
  lastError = null;
  if (await useDirect()) {
    // No Kilo program: Duet runs the browser sign-in itself.
    const abort = new AbortController();
    const timer = setTimeout(() => stopSignIn('timeout'), 5 * 60_000);
    signIn = { id, url: null, proc: null as unknown as ResultPromise, abort, reason: null, timer };
    stateChanged();
    void directSignIn(c, (u) => {
      if (signIn?.id === id) {
        signIn.url = u;
        stateChanged();
      }
    }, abort.signal).then((ok) => {
      const reason = signIn?.id === id ? signIn.reason : 'cancel';
      clearTimeout(timer);
      if (signIn?.id === id) signIn = null;
      status = null;
      if (!ok && reason !== 'cancel') lastError = { id, message: reason === 'timeout' ? tr('Sign-in timed out after 5 minutes.') : tr("Sign-in to {name} didn't finish. Try again.", { name: c.name }) };
      log.info({ app: id, connected: ok }, 'app sign-in ended');
      stateChanged();
    });
    return { ok: true };
  }
  // Own process group: the kilo launcher starts a child that holds the callback port, and killing
  // only the launcher would leave it running. Cancel and timeout stop the whole group.
  const proc = execa('kilo', ['mcp', 'auth', id], { cwd: WORKSPACE, env: kiloEnv(), stdin: 'ignore', reject: false, detached: process.platform !== 'win32' });
  const timer = setTimeout(() => stopSignIn('timeout'), 5 * 60_000);
  signIn = { id, url: null, proc, reason: null, timer };
  let seen = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    seen = (seen + stripAnsi(chunk.toString())).slice(-8000);
    const m = seen.match(/https?:\/\/\S*response_type=\S*/);
    if (signIn && !signIn.url && m) {
      signIn.url = m[0];
      stateChanged();
    }
  });
  void proc.then(async () => {
    const reason = signIn?.proc === proc ? signIn.reason : 'cancel';
    clearTimeout(timer);
    if (signIn?.proc === proc) signIn = null;
    stateChanged();
    const st = await connectorStatus(true);
    const connected = st?.[id]?.state === 'connected';
    if (!connected && reason !== 'cancel')
      lastError = { id, message: reason === 'timeout' ? tr('Sign-in timed out after 5 minutes.') : tr("Sign-in to {name} didn't finish. Try again.", { name: c.name }) };
    log.info({ app: id, connected }, 'app sign-in ended');
    stateChanged();
  });
  stateChanged();
  return { ok: true };
}

function stopSignIn(reason: 'cancel' | 'timeout'): void {
  if (signIn?.abort) {
    signIn.reason = reason;
    signIn.abort.abort();
    return;
  }
  if (!signIn?.proc.pid) return;
  signIn.reason = reason;
  const pid = signIn.proc.pid;
  const kill = (sig: NodeJS.Signals) => {
    try {
      // Windows has no process groups: taskkill /T ends the launcher and its children.
      if (process.platform === 'win32') void execa('taskkill', ['/pid', String(pid), '/T', '/F'], { reject: false });
      else process.kill(-pid, sig);
    } catch {
      /* already gone */
    }
  };
  kill('SIGTERM');
  setTimeout(() => kill('SIGKILL'), 1500).unref();
}

export function cancelSignIn(): void {
  stopSignIn('cancel');
}

// Never leave the callback port held after ThreatDuet quits.
process.once('exit', () => {
  if (signIn?.proc?.pid)
    try {
      if (process.platform === 'win32') execaSync('taskkill', ['/pid', String(signIn.proc.pid), '/T', '/F'], { reject: false });
      else process.kill(-signIn.proc.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
});

/** What Duet is told about the apps it can reach. */
export function connectedAppsLine(): string {
  const on = db.data.connectors.filter((c) => c.enabled);
  const cloudComputer = db.data.cloudBroker || db.data.computer;
  const computer = cloudComputer
    ? db.data.computerAuto
      ? `You have your own cloud computer ("${cloudComputer.name}") with a browser and a shell. ALLOW ALL: the user chose to let you use it without asking, so every computer_ tool (open, read, click, type, run commands, write files) works on your own: use them directly instead of proposing them as ACTIONS. Still never send, pay or delete outside it without being told to. Never use it to look at the user's files on their own machine.`
      : `You have your own cloud computer ("${cloudComputer.name}") with a browser. On your own you may read web pages there (browser_read, browser_screenshot, read_file${db.data.settings.openWebPages ? ', browser_open' : ''}). Opening ${db.data.settings.openWebPages ? 'pages you were not told about' : 'pages (browser_open)'}, clicking, typing, running commands and writing files there change things, so propose them as ACTIONS and name the computer. Never use it to look at the user's files on their own machine.`
    : '';
  // Both places are attached at once; Duet picks per task.
  const where =
    (db.data.cloudBroker || db.data.computer) && macOn()
      ? `You can work in two places; pick the one that fits each step and say which you used. The user's own ${OS_NAME} (local_ tools): their files, their signed-in browser and accounts, their local apps. Your cloud computer (computer_ tools): installing software, long, heavy or risky jobs, trying untrusted code or downloads, and browsing that must not happen as the user.`
      : '';
  const m = db.data.mac;
  const mac = macOn()
    ? [
        `You can reach the user's own ${OS_NAME}.`,
        m.auto ? `AUTO MODE: the user chose to let you act on the ${OS_NAME} without asking. The ${OS_NAME} tools below (writing files, running commands, browsing, clicking, typing) work on your own: use them directly instead of proposing them as ACTIONS. Still never delete, send or pay without being told to.` : '',
        m.files
          ? m.everything
            ? `Files: local_files_list, local_files_read and local_files_search work on your own anywhere on the ${OS_NAME} (folders holding passwords and keys are refused). local_files_read also extracts text from PDFs — use it instead of Python packages. ${m.auto ? 'local_files_write works on your own too.' : 'Writing a file is an ACTION.'}`
            : `Files: local_files_list, local_files_read and local_files_search work on your own in these folders only (PDFs included via local_files_read): ${m.folders.join(', ') || '(none added yet)'}. ${m.auto ? 'local_files_write works on your own too.' : 'Writing a file there is an ACTION.'}`
          : '',
        m.browser
          ? "Browser: the user's own browser sign-ins (Brave, Chrome or Firefox), so you are signed in to their accounts. You may read and scroll what is open (local_browser_read, local_browser_screenshot, local_browser_scroll)" +
            (m.auto ? ', open pages, click and type on your own' : db.data.settings.openWebPages ? ', and open pages (local_browser_open)' : '; opening pages, clicking and typing are ACTIONS') +
            ". Actions there happen as the user. If a site asks to sign in, call local_browser_ask_input so they can enter a password in the secure prompt (never in chat). Sessions persist; call local_browser_push_session to copy them to Duet's cloud computer when needed. They can also sign in in their own browser, then call local_browser_reload_signins."
          : '',
        m.shell
          ? m.auto
            ? `Commands (${process.platform === 'win32' ? 'Windows PowerShell' : 'shell'}): local_shell_run works on your own. Prefer commands that only read; say what you ran.`
            : `Commands (${process.platform === 'win32' ? 'Windows PowerShell' : 'shell'}): running one on the ${OS_NAME} is an ACTION. Put every command in the ACTIONS block exactly as it must run, each in its own \`\`\` fenced block: only those exact commands will be allowed to run.`
          : '',
        `Never copy what you read on the ${OS_NAME} into web addresses, searches or messages unless the user approved exactly that.`,
      ]
        .filter(Boolean)
        .join(' ')
    : '';
  if (!on.length) return `${computer || 'No cloud computer is connected.'} ${mac} ${where} No apps are connected yet. You can only see your workspace, the web${macOn() ? ` and what the ${OS_NAME} tools allow` : ''}.`.replace(/\s+/g, ' ').trim();
  const free = on.filter((c) => c.autoRead).map((c) => c.name);
  const ask = on.filter((c) => !c.autoRead).map((c) => c.name);
  return [
    computer,
    mac,
    where,
    `Connected apps: ${on.map((c) => c.name).join(', ')}.`,
    free.length ? `You may use the read-only tools of ${free.join(', ')} on your own.` : '',
    ask.length ? `For ${ask.join(', ')}, even reading needs the user's approval: propose it.` : '',
    'Tools that change something in an app are hidden from you: propose those as ACTIONS, naming the app.',
    on.some((c) => c.presetId === 'link' || c.presetId === 'shop' || /^(link|shop)/i.test(c.id))
      ? 'Purchases: Link and/or Shop Pay are connected. Propose the buy as ACTIONS first; after approval use those tools and never put card numbers in ACTIONS or replies.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}
