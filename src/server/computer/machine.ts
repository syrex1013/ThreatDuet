import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import PQueue from 'p-queue';
import type { ComputerChoice, ComputerScreen, ComputerStatus } from '../../shared/types.js';
import { VM_DRIVER_DIR, VM_WORK_DIR, WORKSPACE, log } from '../config.js';
import { stateChanged } from '../events.js';
import { db, PROTECTED } from '../store.js';
import { Instabox, InstaboxError } from './instabox.js';

const DRIVER_SOURCE = new URL('./vm/duet-browser.mjs', import.meta.url);

let makeClient = (key: string) => new Instabox(key);
/** Tests swap in a fake API. */
export function setClientFactory(f: (key: string) => Instabox): void {
  makeClient = f;
  client = null;
}

// Shipped inside the app on purpose, so setup needs no key. Anyone with the app can extract it.
const DEFAULT_API_KEY = 'ibk_kilc7pkj5j32z3rpleuo6cvipfvzrsmrfo477fzxv2qxrubyepya';

let client: { key: string; api: Instabox } | null = null;
function api(): Instabox {
  const rec = db.data.computer;
  if (!rec) throw new Error("Duet doesn't have a computer yet. Connect one in the Computer panel.");
  if (!client || client.key !== rec.apiKey) client = { key: rec.apiKey, api: makeClient(rec.apiKey) };
  return client.api;
}

let driverReady = false;
let awakeUntil = 0;
let setup: ComputerStatus['setup'] = null;
let stateCache: { state: string; at: number } | null = null;
// One browser, one thing at a time: Duet's actions and the person's take-over never overlap.
const browserQueue = new PQueue({ concurrency: 1 });

const firstLine = (s: string) => (s ?? '').trim().split('\n')[0].slice(0, 200);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function listChoices(apiKey = DEFAULT_API_KEY): Promise<ComputerChoice[]> {
  const a = makeClient(apiKey);
  await a.me();
  return (await a.listMachines()).map((m) => ({
    id: m.id,
    name: m.name,
    state: m.state,
    vault: Boolean(m.vault),
    hasBrowser: /browser|desktop/i.test(m.template?.id ?? ''),
  }));
}

/** What the status panel shows: from the cache only, so reading the state never calls Instabox. */
export function computerBrief(): { name: string; state: string | null } | null {
  const rec = db.data.computer;
  return rec ? { name: rec.name, state: stateCache?.state ?? null } : null;
}

export async function computerStatus(): Promise<ComputerStatus> {
  const rec = db.data.computer;
  if (!rec) return { connected: false, name: null, machineId: null, machineState: null, vault: false, setup, error: null };
  let error: string | null = null;
  if (!stateCache || Date.now() - stateCache.at > 15_000) {
    try {
      stateCache = { state: (await api().getMachine(rec.machineId)).state, at: Date.now() };
    } catch (e) {
      error = errText(e);
      stateCache = { state: 'unknown', at: Date.now() };
    }
  }
  return { connected: true, name: rec.name, machineId: rec.machineId, machineState: stateCache.state, vault: rec.vault, setup, error };
}

/** Wakes the machine if it was paused or stopped. Exec also wakes an idle-paused one, but not one that was switched off. */
export async function ensureAwake(): Promise<void> {
  if (Date.now() < awakeUntil) return;
  const rec = db.data.computer;
  if (!rec) throw new Error("Duet doesn't have a computer yet.");
  const a = api();
  const deadline = Date.now() + 150_000;
  for (;;) {
    const m = await a.getMachine(rec.machineId);
    stateCache = { state: m.state, at: Date.now() };
    if (m.state === 'running') break;
    if (m.state === 'suspended' || m.state === 'paused') await a.power(rec.machineId, 'resume');
    else if (m.state === 'stopped') await a.power(rec.machineId, 'start');
    else if (Date.now() > deadline) throw new Error(`The computer is ${m.state} and won't wake up. Check it in the Instabox dashboard.`);
    else await new Promise((r) => setTimeout(r, 3000));
  }
  awakeUntil = Date.now() + 60_000;
  stateChanged();
}

async function vmExec(o: Parameters<Instabox['exec']>[1]) {
  await ensureAwake();
  try {
    return await api().exec(db.data.computer!.machineId, o);
  } catch (e) {
    if (e instanceof InstaboxError && e.code === 'machine_not_running') {
      awakeUntil = 0;
      await ensureAwake();
      return api().exec(db.data.computer!.machineId, o);
    }
    throw e;
  }
}

/** Version of the driver on the machine: its content hash, so a new OpenDuet updates it by itself. */
async function driverSource() {
  const source = await fs.readFile(DRIVER_SOURCE, 'utf8');
  return { source, version: createHash('sha256').update(source).digest('hex').slice(0, 12) };
}

export async function installDriver(): Promise<void> {
  const { source, version } = await driverSource();
  const have = await vmExec({
    cmd: 'cat "$D/VERSION" 2>/dev/null; test -d "$D/node_modules/playwright-core" && echo has-playwright',
    envs: { D: VM_DRIVER_DIR },
  });
  if (have.stdout.includes(version) && have.stdout.includes('has-playwright')) {
    await vmExec({ argv: ['mkdir', '-p', VM_WORK_DIR] });
    driverReady = true;
    return;
  }
  const r = await vmExec({
    cmd:
      'set -e; mkdir -p "$D" "$W"; cd "$D"; ' +
      '[ -f package.json ] || echo \'{"name":"openduet-vm","private":true,"type":"module"}\' > package.json; ' +
      '[ -d node_modules/playwright-core ] || npm i playwright-core --no-audit --no-fund --loglevel=error',
    envs: { D: VM_DRIVER_DIR, W: VM_WORK_DIR },
    timeoutSeconds: 280,
  });
  if (r.exitCode !== 0) throw new Error(`Couldn't install the browser driver on the computer: ${firstLine(r.stderr) || 'npm failed'}`);
  await api().writeFile(db.data.computer!.machineId, `${VM_DRIVER_DIR}/duet-browser.mjs`, source);
  await api().writeFile(db.data.computer!.machineId, `${VM_DRIVER_DIR}/VERSION`, version);
  driverReady = true;
}

const DESKTOP_HINT =
  "The computer's desktop isn't running. Open this machine's Computer tab in the Instabox dashboard once, then try again.";

function friendly(message: string): string {
  return /did not start|missing x server|cannot open display/i.test(message) ? DESKTOP_HINT : message;
}

export type BrowserResult = { ok: true; url?: string; title?: string; text?: string; elements?: unknown[]; mime?: string; base64?: string; status?: string };

/** One browser action on the computer. Arguments travel as an argv entry, never through a shell. */
export function browser(action: 'start' | 'open' | 'read' | 'screenshot' | 'click' | 'type' | 'press', args: Record<string, unknown> = {}): Promise<BrowserResult> {
  return browserQueue.add(async () => {
    if (!driverReady) await installDriver();
    const r = await vmExec({
      argv: ['node', `${VM_DRIVER_DIR}/duet-browser.mjs`, action, JSON.stringify(args)],
      cwd: VM_DRIVER_DIR,
      envs: { DISPLAY: ':1' },
      timeoutSeconds: 90,
    });
    const line = r.stdout.trim().split('\n').filter(Boolean).at(-1) ?? '';
    let out: any;
    try {
      out = JSON.parse(line);
    } catch {
      throw new Error(friendly(`The browser didn't answer (${firstLine(r.stderr) || 'no output'}).`));
    }
    if (!out.ok) throw new Error(friendly(String(out.error ?? 'The browser action failed.')));
    return out as BrowserResult;
  }) as Promise<BrowserResult>;
}

/** Duet's working folder on the computer. Reads, writes and copies never leave it. */
export async function safeVmPath(p: string): Promise<string> {
  const wanted = path.posix.resolve(VM_WORK_DIR, p);
  const r = await vmExec({ argv: ['realpath', '-m', '--', wanted] });
  const real = r.stdout.trim();
  if (r.exitCode !== 0 || !(real === VM_WORK_DIR || real.startsWith(`${VM_WORK_DIR}/`)))
    throw new Error(`Duet only works inside ${VM_WORK_DIR} on its computer.`);
  return real;
}

export async function readVmFile(p: string): Promise<string> {
  const real = await safeVmPath(p);
  const f = await api().readFile(db.data.computer!.machineId, real);
  if (f.entries) return `Folder ${real}:\n${(f.entries as { name?: string; type?: string }[]).map((e) => `${e.type === 'dir' || e.type === 'directory' ? '[dir] ' : ''}${e.name ?? ''}`).join('\n')}`;
  if (f.binary) return `${real} is a binary file. Use copy_to_workspace to bring it to this computer.`;
  return f.content ?? '';
}

export async function writeVmFile(p: string, content: string): Promise<string> {
  const real = await safeVmPath(p);
  const bytes = await api().writeFile(db.data.computer!.machineId, real, content);
  return `Wrote ${bytes} bytes to ${real}.`;
}

export async function runVmCommand(cmd: string, timeoutSeconds = 120): Promise<string> {
  await vmExec({ argv: ['mkdir', '-p', VM_WORK_DIR] });
  const r = await vmExec({ cmd, cwd: VM_WORK_DIR, timeoutSeconds: Math.min(Math.max(timeoutSeconds, 1), 600) });
  const cap = (s: string) => (s.length > 30_000 ? `${s.slice(0, 30_000)}\n[output cut at 30,000 characters]` : s);
  return [r.stdout && `stdout:\n${cap(r.stdout)}`, r.stderr && `stderr:\n${cap(r.stderr)}`, `exit code ${r.exitCode}${r.timedOut ? ' (timed out)' : ''}`].filter(Boolean).join('\n');
}

/** Brings a file Duet made on its computer into this computer's OpenDuet workspace. */
export async function copyToWorkspace(vmPath: string, name?: string): Promise<string> {
  const real = await safeVmPath(vmPath);
  const target = path.basename(name || real);
  if (!target || target.startsWith('.') || PROTECTED.includes(target)) throw new Error(`Can't save a file called ${target || '(empty)'} in the workspace.`);
  const r = await vmExec({ argv: ['base64', '-w0', '--', real] });
  if (r.exitCode !== 0) throw new Error(`Couldn't read ${real}: ${firstLine(r.stderr)}`);
  if (r.truncated) throw new Error('That file is too large to copy (about 700 KB at most).');
  await fs.writeFile(path.join(WORKSPACE, target), Buffer.from(r.stdout.trim(), 'base64'));
  return `Saved ${target} in the workspace.`;
}

/** A fresh screenshot for the Watch panel; never wakes a sleeping machine on its own. */
export async function screen(wake = false): Promise<ComputerScreen> {
  const st = await computerStatus();
  if (!st.connected) return { asleep: true };
  if (st.machineState !== 'running' && !wake) return { asleep: true };
  const r = await browser('screenshot');
  return { asleep: false, url: r.url, title: r.title, mime: r.mime, base64: r.base64 };
}

// ---- setup ----

const step = (text: string) => {
  setup = { running: true, step: text, error: null };
  stateChanged();
};

/** Connects (or re-checks) the computer in the background; progress shows in computerStatus().setup. */
export async function connectComputer(input: { apiKey?: string; machineId: string }): Promise<{ ok: true } | { error: string }> {
  if (setup?.running) return { error: 'Setup is already running.' };
  const apiKey = input.apiKey ?? DEFAULT_API_KEY;
  let machine;
  try {
    const a = makeClient(apiKey);
    await a.me();
    machine = await a.getMachine(input.machineId);
  } catch (e) {
    return { error: errText(e) };
  }
  db.data.computer = { apiKey, machineId: machine.id, name: machine.name, connectedAt: Date.now(), vault: Boolean(machine.vault) };
  client = null;
  driverReady = false;
  awakeUntil = 0;
  stateCache = null;
  await db.write();
  void runSetup();
  return { ok: true };
}

export async function retrySetup(): Promise<{ ok: true } | { error: string }> {
  if (!db.data.computer) return { error: "Duet doesn't have a computer yet." };
  if (setup?.running) return { error: 'Setup is already running.' };
  void runSetup();
  return { ok: true };
}

async function runSetup(): Promise<void> {
  let where = 'Waking the computer';
  try {
    step(where);
    await ensureAwake();
    step((where = 'Installing the browser driver'));
    await installDriver();
    step((where = 'Starting the browser'));
    await browser('start');
    step((where = 'Checking that it can browse'));
    await browser('open', { url: 'https://example.com' });
    const page = await browser('read');
    // The heading may be missing from the text on a redesigned example.com; the title is stable.
    if (!/Example Domain/.test(`${page.title ?? ''} ${page.text ?? ''}`)) throw new Error("The browser started but couldn't load a test page. Does the computer have internet access?");
    setup = null;
    log.info({ machine: db.data.computer?.name }, 'computer ready');
  } catch (e) {
    setup = { running: false, step: where, error: errText(e) };
    log.warn({ err: errText(e) }, 'computer setup failed');
  }
  stateChanged();
}

export async function disconnectComputer(): Promise<void> {
  // The machine itself is never changed or deleted: it was the user's before and stays theirs.
  db.data.computer = null;
  client = null;
  driverReady = false;
  awakeUntil = 0;
  stateCache = null;
  setup = null;
  await db.write();
}
