import path from 'node:path';
import { execa } from 'execa';
import { RUN_TIMEOUT_MS, WORKSPACE, log } from './config.js';
import { parseKiloEvents, type KiloResult } from './parse.js';
import { kiloEnv } from './connectors.js';
import { KiloServerError, runKiloApi } from './kilo-api.js';
import { db, resetSandbox } from './store.js';

export interface KiloRun {
  prompt: string;
  model: string;
  agent: 'duet' | 'code';
  session?: string | null;
  /** Auto-approve tool permissions. Only for user-approved execution. */
  auto?: boolean;
  /** Called as tools start, with a short phrase for the UI: "reading acme-brief.md". */
  onProgress?: (detail: string) => void;
}

/** What a tool call means to the user, in a few words. */
export function describeTool(tool: string, input: Record<string, unknown> = {}): string {
  const file = typeof input.filePath === 'string' ? path.basename(input.filePath) : '';
  switch (tool) {
    case 'read':
      return file ? `reading ${file}` : 'reading a file';
    case 'write':
    case 'edit':
      return file ? `writing ${file}` : 'writing a file';
    case 'glob':
    case 'grep':
    case 'list':
      return 'searching the workspace';
    case 'websearch':
      return typeof input.query === 'string' ? `searching the web for “${input.query.slice(0, 60)}”` : 'searching the web';
    case 'webfetch':
      try {
        return `reading ${new URL(String(input.url)).hostname}`;
      } catch {
        return 'reading a web page';
      }
    case 'bash':
      return typeof input.description === 'string' ? input.description.toLowerCase().slice(0, 80) : 'running a command';
    case 'todowrite':
    case 'todoread':
      return 'planning';
    case 'skill':
      return 'loading a skill';
  }
  if (tool.startsWith('mac_')) {
    const known: Record<string, string> = {
      mac_files_list: 'looking in a folder on your computer',
      mac_files_read: 'reading a file on your computer',
      mac_files_search: 'searching your files',
      mac_files_write: 'writing a file on your computer',
      mac_shell_run: 'running a command on your computer',
      mac_browser_open: 'opening a page in your browser',
      mac_browser_read: 'reading the page in your browser',
      mac_browser_screenshot: 'looking at the page in your browser',
      mac_browser_click: 'clicking in your browser',
      mac_browser_type: 'typing in your browser',
      mac_browser_press: 'typing in your browser',
    };
    return known[tool] ?? 'using your computer';
  }
  if (tool.startsWith('computer_')) {
    const url = typeof input.url === 'string' ? input.url : '';
    switch (tool) {
      case 'computer_browser_open':
        try {
          return `opening ${new URL(url).hostname} on its computer`;
        } catch {
          return 'opening a page on its computer';
        }
      case 'computer_browser_read':
        return 'reading the page on its computer';
      case 'computer_browser_screenshot':
        return 'looking at the screen of its computer';
      case 'computer_browser_click':
        return 'clicking on its computer';
      case 'computer_browser_type':
      case 'computer_browser_press':
        return 'typing on its computer';
      case 'computer_run':
        return 'running a command on its computer';
      default:
        return 'using its computer';
    }
  }
  const app = tool.includes('_') ? tool.split('_')[0] : '';
  return app ? `using ${app}` : 'working';
}

/** One turn, through Kilo's HTTP server (default) or the CLI. If the server can't start, the CLI takes over. */
export async function runKilo(run: KiloRun): Promise<KiloResult> {
  await resetSandbox();
  if (db.data.settings.kiloMode !== 'cli') {
    try {
      return await runKiloApi(run, describeTool);
    } catch (e) {
      if (!(e instanceof KiloServerError)) throw e;
      log.warn({ err: e.message }, 'kilo server unavailable, using the CLI');
    }
  }
  return runKiloCli(run);
}

async function runKiloCli({ prompt, model, agent, session, auto, onProgress }: KiloRun): Promise<KiloResult> {
  // The prompt goes in on stdin: Windows refuses line breaks in the arguments of a .cmd program.
  const args = ['run', '--format', 'json', '--dir', WORKSPACE, '-m', model, '--agent', agent];
  if (session) args.push('-s', session);
  if (auto) args.push('--auto');

  const proc = execa('kilo', args, {
    cwd: WORKSPACE,
    // kilo resolves its project from $PWD, not the process cwd; an inherited PWD would load the
    // parent directory's config and skip the workspace sandbox entirely. KILO_CONFIG adds the apps.
    env: kiloEnv(),
    input: prompt,
    reject: false,
    timeout: RUN_TIMEOUT_MS,
    forceKillAfterDelay: 5000,
    buffer: { stdout: false, stderr: true },
  });

  // Read the event stream as it comes so the UI can show what Duet is doing right now.
  const lines: string[] = [];
  for await (const line of proc.iterable({ from: 'stdout' })) {
    lines.push(line);
    if (!onProgress || !line.startsWith('{')) continue;
    try {
      const e = JSON.parse(line);
      const p = e.part ?? {};
      if (p.type === 'tool' && p.state?.status !== 'completed' && p.state?.status !== 'error')
        onProgress(describeTool(p.tool, p.state?.input ?? {}));
      else if (p.type === 'text') onProgress('writing a reply');
    } catch {
      /* partial or non-JSON line */
    }
  }
  const done = await proc;

  const result = parseKiloEvents(lines.join('\n'));
  if (done.failed && !result.text) {
    const stderr = (done.stderr ?? '').split('\n').filter((l) => !l.includes(' INFO ')).slice(-5).join(' ');
    result.errors.push(done.timedOut ? 'kilo timed out' : `kilo exited ${done.exitCode}: ${stderr || done.shortMessage}`);
  }
  return result;
}

