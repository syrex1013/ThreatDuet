export type Role = 'user' | 'duet' | 'system';
export type Kind = 'chat' | 'brief' | 'check' | 'report' | 'followup' | 'task' | 'done' | 'error' | 'info';
export type ProposalStatus = 'pending' | 'approved' | 'done' | 'failed' | 'rejected' | 'blocked' | 'interrupted';

export interface ToolUse {
  tool: string;
  status?: string;
  title?: string;
}

export interface Proposal {
  actions: string;
  status: ProposalStatus;
  reason?: string | null;
  remindedAt?: number;
  /** Sensitive topics (health, finances) the user shares by approving. */
  flags?: string[];
}

export interface Message {
  id: string;
  ts: number;
  role: Role;
  kind: Kind;
  text: string;
  tools?: ToolUse[];
  sessionID?: string | null;
  proposal?: Proposal;
  replyTo?: string;
  /** Channel id; absent means the main thread. */
  channel?: string;
  /** Client-only: sent, not yet confirmed by the server. */
  pending?: boolean;
}

export interface Settings {
  model: string;
  briefAt: string;
  reportAt: string;
  checkEveryHours: number;
  quietStart: string;
  quietEnd: string;
  focus: string;
  /** Whether Duet may open web pages without asking while apps are connected (an exfiltration path). */
  openWebPages: boolean;
  /** How Duet reaches Kilo: its local HTTP server, one `kilo run` per turn, or Kilo's hosted API with Duet's own agent. */
  kiloMode: 'api' | 'cli' | 'direct';
  /** Language of the app and of everything Duet writes. */
  language: Language;
}

export type Language = 'en' | 'pl';

/**
 * connected: Duet can use it. needs-sign-in: OAuth not done yet. signing-in: browser flow running.
 * off: switched off. error: the server didn't answer. unknown: not checked yet.
 */
export type ConnectorState = 'connected' | 'needs-sign-in' | 'signing-in' | 'off' | 'error' | 'unknown';

/** A connected app as the UI sees it. Never carries URLs or credentials. */
export interface ConnectorInfo {
  id: string;
  name: string;
  /** Host name (or program name for one that runs on this computer), for display. */
  site: string;
  kind: 'remote' | 'local';
  presetId: string | null;
  enabled: boolean;
  /** Duet may use this app's read-only tools without asking. */
  autoRead: boolean;
  state: ConnectorState;
  detail: string | null;
}

export interface ConnectorsResponse {
  connectors: ConnectorInfo[];
  /** The sign-in in progress, with the page to finish it on (this computer only). */
  signIn: { id: string; url: string | null } | null;
  lastError: { id: string; message: string } | null;
  openWebPages: boolean;
}

export interface FollowUpItem {
  id: string;
  at: number;
  what: string;
}

/** A recurring job on a 5-field cron pattern. Ones Duet suggests start off until the user turns them on. */
export interface RoutineItem {
  id: string;
  what: string;
  cron: string;
  enabled: boolean;
  createdAt: number;
  lastRun: number | null;
}

/**
 * Work Duet came up with itself. 'queued' ones it starts on its own (workspace-only work; anything that
 * affects others still becomes a proposal); 'suggested' ones wait for the user to start, mark done, or dismiss them.
 */
export type TaskStatus = 'suggested' | 'queued' | 'running' | 'done' | 'failed' | 'dismissed';
export interface TaskItem {
  id: string;
  title: string;
  details: string;
  status: TaskStatus;
  createdAt: number;
  startedAt: number | null;
  doneAt: number | null;
  channel?: string;
}

export interface UpcomingRoutine {
  kind: 'brief' | 'report' | 'check';
  at: number;
}

export interface RemoteAddress {
  address: string;
  /** tailscale addresses are encrypted end to end; lan addresses are only as private as the network. */
  kind: 'tailscale' | 'lan';
}

/** Phone access, as seen by the desktop UI only. */
export interface RemoteInfo {
  enabled: boolean;
  port: number;
  token: string | null;
  /** Paired phones may approve commands and drive the browser (sign into sites). */
  phoneCommands: boolean;
  addresses: RemoteAddress[];
}

/** A machine on the user's Instabox account, as offered when connecting Duet's computer. */
export interface ComputerChoice {
  id: string;
  name: string;
  state: string;
  vault: boolean;
  /** The agent-browser template ships Chromium and a desktop. */
  hasBrowser: boolean;
}

export interface ComputerStatus {
  connected: boolean;
  name: string | null;
  machineId: string | null;
  /** running, suspended, stopped, ... or unknown while it can't be reached. */
  machineState: string | null;
  vault: boolean;
  /** Allow all: Duet acts on the cloud computer without asking. */
  auto: boolean;
  /** Setup in progress or the last setup failure. */
  setup: { running: boolean; step: string; error: string | null } | null;
  error: string | null;
}

export interface ComputerScreen {
  asleep: boolean;
  url?: string;
  title?: string;
  mime?: string;
  base64?: string;
}

export type InputKind = 'password' | 'text' | 'otp';
/** Secure prompt waiting for the user; the value itself never appears in state. */
export interface PendingInput {
  id: string;
  kind: InputKind;
  prompt: string;
  target: 'local' | 'computer';
  ref?: number;
  url?: string;
  createdAt: number;
}

export interface StateResponse {
  settings: Settings;
  messages: Message[];
  followups: FollowUpItem[];
  upcoming: UpcomingRoutine[];
  routines: (RoutineItem & { nextAt: number | null })[];
  digestCount: number;
  busy: string | null;
  /** What Duet is doing this moment, e.g. "reading acme-brief.md". */
  busyDetail: string | null;
  /** Duet's cloud computer, if one is connected. */
  computer: { name: string; state: string | null } | null;
  /** Bumps on every change; the live feed sends it so clients know when to refetch. */
  version: number;
  memory: string;
  /** Topic channels besides the main thread. They share Duet's memory but each keeps its own context. */
  channels: { id: string; name: string }[];
  /** Duet's own tasks, newest first: open ones plus the last few finished. */
  tasks: TaskItem[];
  /** False until the first-launch setup is finished or skipped. */
  setupDone: boolean;
  /** The computer Duet runs on, so a paired phone names it right. */
  os: OsId;
  /** Suggestions to show in the recommendations popup; null once seen or when none are open. */
  recs: { at: number; tasks: TaskItem[] } | null;
  /** Password/OTP/text prompt Duet opened; null when none. */
  pendingInput: PendingInput | null;
}

export type OsId = 'mac' | 'windows' | 'linux';

/** What Duet may reach on this Mac. Managed from this computer only. */
export interface MacStatus {
  os: OsId;
  files: boolean;
  /** Files anywhere on the computer (credential stores still excluded), instead of only the folders below. */
  everything: boolean;
  /** macOS: whether the app has Full Disk Access, which "everything" needs for Mail, Safari and the like. Null elsewhere. */
  fullDisk: boolean | null;
  folders: string[];
  shell: boolean;
  browser: boolean;
  /** Allow-all: Duet writes, runs commands and acts in the browser here without a proposal. */
  auto: boolean;
  /** Whose sign-ins Duet browses with. */
  browserApp: 'auto' | BrowserId;
  browsers: BrowserChoice[];
  /** What is running for Duet right now (with a copy of the sign-ins), or null. */
  browserRunning: string | null;
}

export type BrowserId = 'brave' | 'chrome' | 'firefox';
export interface BrowserChoice {
  id: BrowserId;
  name: string;
  installed: boolean;
}
