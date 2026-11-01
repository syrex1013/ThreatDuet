import path from 'node:path';
import { execa } from 'execa';
import { RUN_TIMEOUT_MS, WORKSPACE, log } from './config.js';
import { parseKiloEvents, type KiloResult } from './parse.js';
import { kiloEnv } from './connectors.js';
import { useDirect } from './direct/available.js';
import { runDirect } from './direct/runtime.js';
import { KiloServerError, runKiloApi } from './kilo-api.js';
import { db, resetSandbox } from './store.js';
import { tr } from './i18n.js';

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
  const named = input.filePath ?? input.path;
  const file = typeof named === 'string' ? path.basename(named) : '';
  switch (tool) {
    case 'read':
      return file ? tr('reading {file}', { file }) : tr('reading a file');
    case 'write':
    case 'edit':
      return file ? tr('writing {file}', { file }) : tr('writing a file');
    case 'glob':
    case 'grep':
    case 'list':
      return tr('searching the workspace');
    case 'websearch':
      return typeof input.query === 'string' ? tr('searching the web for “{query}”', { query: input.query.slice(0, 60) }) : tr('searching the web');
    case 'webfetch':
      try {
        return tr('reading {file}', { file: new URL(String(input.url)).hostname });
      } catch {
        return tr('reading a web page');
      }
    case 'bash':
      return typeof input.description === 'string' ? input.description.toLowerCase().slice(0, 80) : tr('running a command');
    case 'todowrite':
    case 'todoread':
      return tr('planning');
    case 'skill':
      return tr('loading a skill');
  }
  if (tool.startsWith('local_')) {
    const known: Record<string, string> = {
      local_files_list: 'looking in a folder on your computer',
      local_files_read: 'reading a file on your computer',
      local_files_search: 'searching your files',
      local_files_write: 'writing a file on your computer',
      local_shell_run: 'running a command on your computer',
      local_browser_open: 'opening a page in your browser',
      local_browser_read: 'reading the page in your browser',
      local_browser_screenshot: 'looking at the page in your browser',
      local_browser_click: 'clicking in your browser',
      local_browser_type: 'typing in your browser',
      local_browser_press: 'typing in your browser',
      local_browser_scroll: 'scrolling the page in your browser',
      local_browser_reload_signins: 'picking up your browser sign-ins',
    };
    return tr(known[tool] ?? 'using your computer');
  }
  if (tool.startsWith('computer_')) {
    const url = typeof input.url === 'string' ? input.url : '';
    switch (tool) {
      case 'computer_browser_open':
        try {
          return tr('opening {host} on its computer', { host: new URL(url).hostname });
        } catch {
          return tr('opening a page on its computer');
        }
      case 'computer_browser_read':
        return tr('reading the page on its computer');
      case 'computer_browser_screenshot':
        return tr('looking at the screen of its computer');
      case 'computer_browser_click':
        return tr('clicking on its computer');
      case 'computer_browser_type':
      case 'computer_browser_press':
        return tr('typing on its computer');
      case 'computer_run':
        return tr('running a command on its computer');
      default:
        return tr('using its computer');
    }
  }
  const app = tool.includes('_') ? tool.split('_')[0] : '';
  return app ? tr('using {app}', { app }) : tr('working');
}

/**
 * One turn, with one recovery: a run that dies without an answer (crash, timeout, gateway down, a step
 * that kept failing) is resumed once in its session, told what stopped it. Approved actions are resumed
 * only when the session survived, so nothing already done is done twice.
 */
export async function runKilo(run: KiloRun): Promise<KiloResult> {
  const first = await runOnce(run).catch((e: Error) => ({ sessionID: run.session ?? null, text: '', finalText: '', tools: [], errors: [e.message] }) as KiloResult);
  if (first.text || !first.errors.length) return first;
  // The gateway itself failing (unreachable, rate-limited, 5xx) is not something another prompt can fix.
  if (first.errors.every((e) => /Kilo gateway|NVIDIA NIM|rate-limited/i.test(e))) return first;
  const session = first.sessionID ?? run.session ?? null;
  if (run.agent === 'code' && !session) throw new Error(first.errors.join('; '));
  log.warn({ errors: first.errors }, 'run stopped without an answer, resuming once');
  const prompt = `Your previous attempt stopped before answering (${first.errors.join('; ')}). Continue from where you were${session ? '' : `. The task was:\n${run.prompt}`}. If the same problem blocks you, say in one or two sentences what it is and what you need, then stop.`;
  const second = await runOnce({ ...run, prompt, session });
  // A recovered run keeps only the first attempt's tool chips; its errors were handled.
  second.tools = [...first.tools, ...second.tools];
  if (!second.text) second.errors.unshift(...first.errors);
  return second;
}

async function runOnce(run: KiloRun): Promise<KiloResult> {
  await resetSandbox();
  if (await useDirect()) return runDirect(run, describeTool);
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

