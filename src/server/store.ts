import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execa } from 'execa';
import { JSONFilePreset } from 'lowdb/node';
import { guard } from './policy.js';
import { stateChanged } from './events.js';
import type { Low } from 'lowdb';
import type { ArtifactRevision, Knowledge, PermissionRule, Project, ProviderSettings, Receipt, TaskRun, Usage, Watch, Workflow, BrowserId, FollowUpItem, Message, RoutineItem, Settings, TaskItem } from '../shared/types.js';
import type { ConnectorRecord } from './connectors.js';
import type { SkillRecord } from './skills.js';
import { DATA_DIR, DEFAULT_SETTINGS, MEMORY_FILE, REMOTE_PORT, STATE_FILE, WORKSPACE } from './config.js';

export interface Data {
  installationId: string;
  cloudBroker: import('./computer/broker-client.js').BrokerIdentity | null;
  knowledgeMigrated: boolean;
  knowledgeVersion: number;
  projects: Project[];
  runs: TaskRun[];
  knowledge: Knowledge[];
  permissions: PermissionRule[];
  receipts: Receipt[];
  watches: Watch[];
  workflows: Workflow[];
  revisions: ArtifactRevision[];
  provider: ProviderSettings;
  usage: Usage[];
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
  /** Work Duet came up with itself. */
  tasks: TaskItem[];
  /** First-launch setup finished or skipped. */
  setupDone: boolean;
  /** Low-priority findings held back for the next brief. */
  digest: { ts: number; text: string }[];
  /** Phone access: a second listener that only answers requests carrying this token. */
  remote: { enabled: boolean; token: string | null; port: number; phoneCommands: boolean };
  /** Connected apps. Holds credentials: the data folder is private (0700). */
  connectors: ConnectorRecord[];
  /** What Duet may reach on this Mac. Everything starts off. */
  mac: { files: boolean; everything: boolean; folders: string[]; shell: boolean; browser: boolean; browserApp: 'auto' | BrowserId; auto: boolean };
  /** Installed skills; the files live in data/skills. */
  skills: SkillRecord[];
  /** Duet's cloud computer (an Instabox machine). Holds the API key: the data folder is private (0700). */
  computer: { apiKey: string; machineId: string; name: string; connectedAt: number; vault: boolean } | null;
  /** The user disconnected Duet's computer: don't connect one again on its own. */
  computerOptOut: boolean;
  /** Allow all on the cloud computer: clicking, typing, commands and files there run without a proposal. */
  computerAuto: boolean;
  /** The recommendations popup: the batch last offered, when the user saw it, and when to offer more (0: not yet planned). */
  recs: { at: number; ids: string[]; seenAt: number; nextAt: number };
}

const initialWorkflows = (): Workflow[] => [
  { name: 'Meeting preparation', instructions: 'Read the meeting agenda and relevant connected correspondence. Research open questions. Save a sourced meeting brief with attendees, decisions needed and an agenda. Ask before contacting anyone.', criteria: 'Saved meeting brief reviewed by the user.' },
  { name: 'Client follow-up', instructions: 'Read the client thread and commitments. Identify the next action and draft a complete response in a workspace file. Ask for fresh approval before sending or changing any external record.', criteria: 'Draft response and its source references reviewed by the user.' },
  { name: 'Weekly project review', instructions: 'Review this project objective, milestones, tasks, decisions and execution receipts. Save a weekly summary of progress, blockers and next steps. Propose external actions separately.', criteria: 'Saved weekly project review checked against current project records.' },
].map((workflow) => ({ ...workflow, id: randomUUID(), connections: [], createdAt: Date.now() }));

// History remains searchable; /state returns only the newest messages per channel.
export let db: Low<Data>;

export async function openStore(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  // Connector credentials live here: only this user may read the folder.
  await fs.chmod(DATA_DIR, 0o700);
  await fs.mkdir(WORKSPACE, { recursive: true, mode: 0o700 });
  await fs.chmod(WORKSPACE, 0o700);
  db = await JSONFilePreset<Data>(STATE_FILE, {
    installationId: randomUUID(), cloudBroker: null,
    knowledgeMigrated: false, knowledgeVersion: 0,
    projects: [], runs: [], knowledge: [], permissions: [], receipts: [], watches: [], workflows: initialWorkflows(), revisions: [], usage: [],
    provider: { baseUrl: '', keyEnv: 'OPENAI_API_KEY', chatModel: '', taskModel: '', maxRequests: 40, maxTokens: 0 },
    settings: DEFAULT_SETTINGS,
    messages: [],
    threadSession: null,
    channels: [],
    lastCheck: 0,
    lastBrief: '',
    lastReport: '',
    followups: [],
    routines: [],
    tasks: [],
    setupDone: false,
    digest: [],
    remote: { enabled: false, token: null, port: REMOTE_PORT, phoneCommands: false },
    connectors: [],
    skills: [],
    mac: { files: false, everything: false, folders: [], shell: false, browser: false, browserApp: 'auto', auto: false },
    computer: null,
    computerOptOut: false,
    computerAuto: false,
    recs: { at: 0, ids: [], seenAt: 0, nextAt: 0 },
  });
  db.data.knowledgeVersion ??= 0;
  db.data.installationId ??= randomUUID();
  db.data.cloudBroker ??= null;
  db.data.projects ??= [];
  db.data.runs ??= [];
  db.data.knowledge ??= [];
  db.data.permissions ??= [];
  db.data.receipts ??= [];
  db.data.watches ??= [];
  db.data.workflows ??= initialWorkflows();
  db.data.revisions ??= [];
  db.data.usage ??= [];
  db.data.provider ??= { baseUrl: '', keyEnv: 'OPENAI_API_KEY', chatModel: '', taskModel: '', maxRequests: 40, maxTokens: 0 };
  db.data.connectors ??= [];
  // 'local' now names Duet's tools on the user's own computer; an app that had that id would clash with them.
  for (const c of db.data.connectors) if (c.id === 'local') c.id = 'local-app';
  db.data.channels ??= [];
  db.data.skills ??= [];
  db.data.mac ??= { files: false, everything: false, folders: [], shell: false, browser: false, browserApp: 'auto', auto: false };
  db.data.mac.browserApp ??= 'auto';
  db.data.mac.everything ??= false;
  db.data.mac.auto ??= false;
  db.data.computer ??= null;
  db.data.computerOptOut ??= false;
  db.data.computerAuto ??= false;
  db.data.recs ??= { at: 0, ids: [], seenAt: 0, nextAt: 0 };
  db.data.remote ??= { enabled: false, token: null, port: REMOTE_PORT, phoneCommands: false };
  db.data.remote.phoneCommands ??= false;
  // Every save is a change the UI may need: announce it to live clients.
  const write = db.write.bind(db);
  db.write = async () => {
    await write();
    stateChanged();
  };
  db.data.followups ??= [];
  db.data.routines ??= [];
  db.data.tasks ??= [];
  for (const task of db.data.tasks) task.titleEdited ??= true;
  // Someone who already used ThreatDuet before setup existed doesn't need it.
  db.data.setupDone ??= db.data.messages.length > 0;
  // A crash can leave external effects uncertain. Resume only after explicit review.
  for (const t of db.data.tasks) if (t.status === 'running' || (t.status === 'queued' && t.startedAt)) {
    t.status = 'interrupted';
    t.reason = 'Restart interrupted this run. Review results before resuming.';
  }
  for (const r of db.data.runs) if (!r.endedAt) { r.status = 'interrupted'; r.endedAt = Date.now(); }
  for (const r of db.data.receipts) if (r.status === 'running') { r.status = 'uncertain'; r.endedAt = Date.now(); }

  db.data.digest ??= [];
  db.data.settings = { ...DEFAULT_SETTINGS, ...db.data.settings };
  // A task cut off by a restart may be half done: never re-run it silently.
  for (const m of db.data.messages) if (m.proposal?.status === 'approved') m.proposal.status = 'interrupted';
  await db.write();
  await fs.writeFile(MEMORY_FILE, '# What Duet remembers about you\n', { flag: 'wx' }).catch(() => {});
  if (!db.data.knowledgeMigrated) {
    const legacy = await readMemory();
    const facts = legacy.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
    if (facts.length) await appendMemory(facts.map((line) => line.replace(/^- /, '')), 'legacy memory');
    db.data.knowledgeMigrated = true;
    await db.write();
  }
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
  await db.write();
  return m;
}

export function invalidateKnowledge(): void {
  db.data.knowledgeVersion++;
  db.data.threadSession = null;
  for (const channel of db.data.channels) channel.session = null;
  for (const task of db.data.tasks) task.session = null;
}

export const readMemory = () => fs.readFile(MEMORY_FILE, 'utf8');
export async function writeMemory(text: string): Promise<void> {
  await fs.writeFile(MEMORY_FILE, text);
  db.data.knowledge = [];
  invalidateKnowledge();
  await appendMemory(text.split('\n').filter((line) => line.trim() && !line.startsWith('#')).map((line) => line.replace(/^- /, '')), 'user');
}

export async function appendMemory(facts: string[], source = 'conversation', scope = 'personal'): Promise<void> {
  for (const text of facts) {
    if (guard(text)?.startsWith('contains')) continue;
    if (db.data.knowledge.some((k) => k.text === text && k.scope === scope)) continue;
    db.data.knowledge.push({ id: randomUUID(), text, kind: source === 'setup' ? 'fact' : 'claim', source, scope, pinned: source === 'setup', createdAt: Date.now(), updatedAt: Date.now() });
  }
  await fs.writeFile(MEMORY_FILE, '# What Duet remembers about you\n' + db.data.knowledge.map((k) => `- ${k.text}\n`).join(''));
  await db.write();
}

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
export function computerRules(openWebPages: boolean, auto = false): Record<string, string> {
  if (auto) return Object.fromEntries(Object.keys(computerRules(true)).map((k) => [k, 'allow']));
  return {
    computer_status: 'allow',
    computer_browser_read: 'allow',
    computer_browser_screenshot: 'allow',
    computer_read_file: 'allow',
    computer_browser_open: openWebPages ? 'allow' : 'deny',
    computer_browser_ask_input: 'allow',
    computer_browser_push_session: 'allow',
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
 * Auto mode (the user's explicit choice) allows all of it without asking.
 */
export function macRules(openWebPages: boolean, auto = false): Record<string, string> {
  if (auto) return Object.fromEntries(Object.keys(macRules(true)).map((k) => [k, 'allow']));
  return {
    local_files_list: 'allow',
    local_files_read: 'allow',
    local_files_search: 'allow',
    local_files_write: 'deny',
    local_shell_run: 'deny',
    local_browser_read: 'allow',
    local_browser_screenshot: 'allow',
    local_browser_scroll: 'allow',
    local_browser_reload_signins: 'allow',
    local_browser_ask_input: 'allow',
    local_browser_push_session: 'allow',
    local_browser_open: openWebPages ? 'allow' : 'deny',
    local_browser_click: 'deny',
    local_browser_type: 'deny',
    local_browser_press: 'deny',
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
  const webOnItsOwn = (apps.length === 0 && !(db.data.cloudBroker || db.data.computer) && !macOn()) || db.data.settings.openWebPages;
  const edit: Record<string, string> = { '*': 'allow' };
  for (const f of PROTECTED) Object.assign(edit, { [f]: 'deny', [`${f}/*`]: 'deny', [`*/${f}`]: 'deny' });

  const duet: Record<string, unknown> = { '*': 'deny' };
  for (const tool of ['invalid', 'read', 'glob', 'grep', 'list', 'websearch', 'codesearch', 'todowrite', 'todoread', 'skill', 'duet_search_chats', 'duet_report_progress', 'duet_update_task'])
    duet[tool] = 'allow';
  duet.webfetch = webOnItsOwn ? 'allow' : 'deny';
  Object.assign(duet, connectorRules(apps.filter((c) => c.autoRead).map((c) => c.id)));
  // Duet's cloud computer: exact names, placed last so they win over the word rules above.
  if (db.data.cloudBroker || db.data.computer) Object.assign(duet, computerRules(db.data.settings.openWebPages, db.data.computerAuto));
  if (macOn()) Object.assign(duet, macRules(db.data.settings.openWebPages, db.data.mac.auto));
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
