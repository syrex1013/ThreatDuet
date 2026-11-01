import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execa } from 'execa';
import { JSONFilePreset } from 'lowdb/node';
import { stateChanged } from './events.js';
import type { Low } from 'lowdb';
import type { BrowserId, FollowUpItem, Message, RoutineItem, Settings } from '../shared/types.js';
import type { ConnectorRecord } from './connectors.js';
import type { SkillRecord } from './skills.js';
import { DATA_DIR, DEFAULT_SETTINGS, MEMORY_FILE, REMOTE_PORT, STATE_FILE, WORKSPACE } from './config.js';

export interface Data {
  settings: Settings;
  messages: Message[];
  threadSession: string | null;
  /** Topic channels; each continues its own kilo session. The main thread uses threadSession. */
  channels: { id: string; name: string; session: string | null; createdAt: number }[];
  lastCheck: number;
  lastBrief: string;
  lastReport: string;
  followups: FollowUpItem[];
  routines: RoutineItem[];
  /** Low-priority findings held back for the next brief. */
  digest: { ts: number; text: string }[];
  /** Phone access: a second listener that only answers requests carrying this token. */
  remote: { enabled: boolean; token: string | null; port: number };
  /** Connected apps. Holds credentials: the data folder is private (0700). */
  connectors: ConnectorRecord[];
  /** What Duet may reach on this Mac. Everything starts off. */
  mac: { files: boolean; folders: string[]; shell: boolean; browser: boolean; browserApp: 'auto' | BrowserId };
  /** Installed skills; the files live in data/skills. */
  skills: SkillRecord[];
  /** Duet's cloud computer (an Instabox machine). Holds the API key: the data folder is private (0700). */
  computer: { apiKey: string; machineId: string; name: string; connectedAt: number; vault: boolean } | null;
}

const MAX_MESSAGES = 500;
export let db: Low<Data>;

export async function openStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  // Connector credentials live here: only this user may read the folder.
  await fs.chmod(DATA_DIR, 0o700);
  await fs.mkdir(WORKSPACE, { recursive: true });
  db = await JSONFilePreset<Data>(STATE_FILE, {
    settings: DEFAULT_SETTINGS,
    messages: [],
    threadSession: null,
    channels: [],
    lastCheck: 0,
    lastBrief: '',
    lastReport: '',
    followups: [],
    routines: [],
    digest: [],
    remote: { enabled: false, token: null, port: REMOTE_PORT },
    connectors: [],
    skills: [],
    mac: { files: false, folders: [], shell: false, browser: false, browserApp: 'auto' },
    computer: null,
  });
  db.data.connectors ??= [];
  db.data.channels ??= [];
  db.data.skills ??= [];
  db.data.mac ??= { files: false, folders: [], shell: false, browser: false, browserApp: 'auto' };
  db.data.mac.browserApp ??= 'auto';
  db.data.computer ??= null;
  db.data.remote ??= { enabled: false, token: null, port: REMOTE_PORT };
  // Every save is a change the UI may need: announce it to live clients.
  const write = db.write.bind(db);
  db.write = async () => {
    await write();
    stateChanged();
  };
  db.data.followups ??= [];
  db.data.routines ??= [];
  db.data.digest ??= [];
  db.data.settings = { ...DEFAULT_SETTINGS, ...db.data.settings };
  // A task cut off by a restart may be half done: never re-run it silently.
  for (const m of db.data.messages) if (m.proposal?.status === 'approved') m.proposal.status = 'interrupted';
  await db.write();
  await fs.writeFile(MEMORY_FILE, '# What Duet remembers about you\n', { flag: 'wx' }).catch(() => {});
  // Kilo's "external" boundary is the git worktree root. Without its own repo, workspace/ would
  // inherit an enclosing repo's root and data/ would count as inside the sandbox.
  await execa('git', ['init', '-q'], { cwd: WORKSPACE });
  await writeWorkspaceConfig();
  const { writeConnectorsConfig } = await import('./connectors.js');
  await writeConnectorsConfig();
}

export async function post(msg: Omit<Message, 'id' | 'ts'>): Promise<Message> {
  const m: Message = { id: randomUUID(), ts: Date.now(), ...msg };
  // A channel closed while Duet was still working: its history went to main, so does this.
  if (m.channel && !db.data.channels.some((c) => c.id === m.channel)) delete m.channel;
  db.data.messages.push(m);
  // Per channel, so a busy main thread never evicts a quiet channel's history.
  const same = db.data.messages.filter((x) => x.channel === m.channel);
  if (same.length > MAX_MESSAGES) {
    const drop = new Set(same.slice(0, same.length - MAX_MESSAGES));
    db.data.messages = db.data.messages.filter((x) => !drop.has(x));
  }
  await db.write();
  return m;
}

export const readMemory = () => fs.readFile(MEMORY_FILE, 'utf8');
export const writeMemory = (text: string) => fs.writeFile(MEMORY_FILE, text);
export const appendMemory = (facts: string[]) => fs.appendFile(MEMORY_FILE, facts.map((f) => `- ${f}\n`).join(''));

// MCP tools are named `<app>_<tool>`. Autonomous work gets only an app's tools whose name starts
// a word with a read verb (get_issue, notion-search, getJiraIssue, GMAIL_FETCH_EMAILS), and never
// ones that mention a change anywhere (fail closed: an unknown verb is hidden). Word starts, not
// substrings: "lock_thread" must not pass as "read", nor "request_review" as "view".
// Kilo's globs are case-sensitive, so each verb is matched in three casings.
// shortcut: name-based screening, not a classifier; per-app "always ask" covers odd naming.
const casings = (w: string) => [w, w.toUpperCase(), w[0].toUpperCase() + w.slice(1)];

const READ_VERBS = [
  'get', 'list', 'search', 'read', 'find', 'fetch', 'query', 'view', 'show', 'describe',
  'lookup', 'retrieve', 'check', 'count', 'ask', 'preview', 'inspect', 'summarize',
];
const SIDE_EFFECT_VERBS = [
  'send', 'post', 'reply', 'forward', 'create', 'update', 'edit', 'modify', 'patch', 'put', 'set',
  'delete', 'remove', 'trash', 'archive', 'move', 'rename', 'add', 'insert', 'write', 'upload',
  'pay', 'charge', 'refund', 'transfer', 'purchase', 'order', 'checkout', 'sign', 'submit',
  'publish', 'share', 'invite', 'schedule', 'cancel', 'book', 'approve', 'merge', 'comment',
  'label', 'mark', 'run', 'execute', 'trigger', 'deploy', 'lock', 'close', 'assign', 'transition',
  'resolve', 'complete', 'enable', 'disable', 'start', 'stop', 'grant', 'revoke', 'reject', 'accept',
  'confirm', 'void', 'capture', 'payout', 'subscribe', 'reset', 'restore', 'release', 'install',
  'push', 'commit', 'apply', 'save', 'sync', 'import', 'copy', 'duplicate', 'clone', 'follow', 'react',
  // Tools that fetch arbitrary addresses would let injected text carry data out.
  'webhook', 'http', 'curl', 'scrape', 'crawl', 'browse', 'navigate',
];

/**
 * Duet's cloud computer. Reading a page it already has open is free; going somewhere new is gated like
 * web fetching; clicking, typing, running commands and writing files always need an approved proposal.
 */
export function computerRules(openWebPages: boolean): Record<string, string> {
  return {
    computer_status: 'allow',
    computer_browser_read: 'allow',
    computer_browser_screenshot: 'allow',
    computer_read_file: 'allow',
    computer_browser_open: openWebPages ? 'allow' : 'deny',
    computer_browser_click: 'deny',
    computer_browser_type: 'deny',
    computer_browser_press: 'deny',
    computer_run: 'deny',
    computer_write_file: 'deny',
    computer_copy_to_workspace: 'deny',
  };
}

/**
 * The Mac's tools. Looking is free; anything that changes a file, runs a command or acts on a signed-in
 * site needs an approved proposal. Opening a page in the signed-in browser follows the web-pages setting.
 */
export function macRules(openWebPages: boolean): Record<string, string> {
  return {
    mac_files_list: 'allow',
    mac_files_read: 'allow',
    mac_files_search: 'allow',
    mac_files_write: 'deny',
    mac_shell_run: 'deny',
    mac_browser_read: 'allow',
    mac_browser_screenshot: 'allow',
    mac_browser_open: openWebPages ? 'allow' : 'deny',
    mac_browser_click: 'deny',
    mac_browser_type: 'deny',
    mac_browser_press: 'deny',
  };
}

/** Rules for connected apps: word-start read tools allowed per app, change words denied everywhere. */
export function connectorRules(readableApps: string[]): Record<string, string> {
  const rules: Record<string, string> = {};
  for (const app of readableApps)
    for (const verb of READ_VERBS)
      for (const v of casings(verb)) Object.assign(rules, { [`${app}_${v}*`]: 'allow', [`${app}_*_${v}*`]: 'allow', [`${app}_*-${v}*`]: 'allow' });
  for (const verb of SIDE_EFFECT_VERBS) for (const v of casings(verb)) rules[`*_*${v}*`] = 'deny';
  // Tools that end in a URL argument ("fetch_url", "open_url") fetch addresses too.
  for (const v of ['_url', '_URL', 'Url']) rules[`*_*${v}`] = 'deny';
  return rules;
}

/**
 * Kilo config for the agent's working directory.
 * - `duet` works on its own: reads, searches, browses, drafts files in workspace/, and uses
 *   read-only connector tools. It has no shell, subagents, or side-effecting connector tools.
 * - `code` runs only after the user approves a proposal.
 * Rules are repeated per agent because built-in agent rules override top-level ones; `task` is
 * denied because subagents do not inherit them. Later rules win.
 */

// Files that would change the agent's own permissions or instructions if it could write them.
export const PROTECTED = ['kilo.json', 'kilo.jsonc', 'opencode.json', 'opencode.jsonc', 'AGENTS.md', 'CLAUDE.md', '.kilo', '.opencode', '.git'];

/**
 * Kilo config for the agent's working directory.
 * - `duet` works on its own: reads, searches, browses, drafts files in workspace/, and uses
 *   read-only connector tools. It has no shell, subagents, or side-effecting connector tools.
 * - `code` runs only after the user approves a proposal.
 * Neither may edit its own config or instruction files. Rules are repeated per agent because
 * built-in agent rules override top-level ones; `task` is denied because subagents do not
 * inherit them. Later rules win.
 */
export const macOn = () => db.data.mac.files || db.data.mac.shell || db.data.mac.browser;

export async function writeWorkspaceConfig(): Promise<void> {
  const fence: Record<string, unknown> = { external_directory: 'deny', task: 'deny' };
  const apps = db.data.connectors.filter((c) => c.enabled);
  // With accounts (or a computer that may hold logins) connected, a fetched page could carry their
  // content out: pages then go through approval.
  const webOnItsOwn = (apps.length === 0 && !db.data.computer && !macOn()) || db.data.settings.openWebPages;
  const edit: Record<string, string> = { '*': 'allow' };
  for (const f of PROTECTED) Object.assign(edit, { [f]: 'deny', [`${f}/*`]: 'deny', [`*/${f}`]: 'deny' });

  const duet: Record<string, unknown> = { '*': 'deny' };
  for (const tool of ['invalid', 'read', 'glob', 'grep', 'list', 'websearch', 'codesearch', 'todowrite', 'todoread', 'skill'])
    duet[tool] = 'allow';
  duet.webfetch = webOnItsOwn ? 'allow' : 'deny';
  Object.assign(duet, connectorRules(apps.filter((c) => c.autoRead).map((c) => c.id)));
  // Duet's cloud computer: exact names, placed last so they win over the word rules above.
  if (db.data.computer) Object.assign(duet, computerRules(db.data.settings.openWebPages));
  if (macOn()) Object.assign(duet, macRules(db.data.settings.openWebPages));
  for (const tool of ['bash', 'background_process', 'schedule_wakeup', 'cancel_wakeup', 'cron_*', 'agent_manager_*', 'link_pr', 'board_*', 'goal*', 'plan_*', 'doom_loop'])
    duet[tool] = 'deny';
  Object.assign(duet, { edit }, fence);

  const config = {
    $schema: 'https://app.kilo.ai/config.json',
    permission: fence,
    agent: {
      duet: {
        mode: 'primary',
        description: 'Proactive coworker: researches, drafts and prepares on its own; side effects need approval',
        permission: duet,
      },
      // After approval Duet works on its cloud computer; this computer never runs a shell for it.
      code: { permission: { edit, ...fence, bash: 'deny' } },
    },
  };
  await fs.writeFile(path.join(WORKSPACE, 'kilo.json'), JSON.stringify(config, null, 2));
  await (await import('./skills.js')).copySkills();
}

/** Restores the sandbox before every run, in case an approved task touched it. */
export async function resetSandbox(): Promise<void> {
  for (const f of PROTECTED.filter((f) => f !== '.git' && f !== 'kilo.json'))
    await fs.rm(path.join(WORKSPACE, f), { recursive: true, force: true });
  await writeWorkspaceConfig();
}
