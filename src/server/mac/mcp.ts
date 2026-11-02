import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { checkBrowseUrl, fail, guard, text, untrusted } from '../computer/mcp.js';
import { db } from '../store.js';
import { browse } from './browser.js';
import { askAndFill, pushSessionToComputer } from '../browser-session.js';
import { listFolder, readText, searchFiles, writeText } from './files.js';
import { OS_NAME, OS_PANEL } from './os.js';
import { runShell } from './shell.js';

const on = (what: 'files' | 'shell' | 'browser') => {
  if (!db.data.mac[what]) throw new Error(`${what === 'browser' ? 'The browser' : what === 'shell' ? 'Commands' : 'Files'} on this ${OS_NAME} are turned off. The user can turn them on in the ${OS_PANEL} panel.`);
};

export function buildMacServer(): McpServer {
  // 'local': the user's own computer, whatever it runs. Tools reach Duet as local_*.
  const server = new McpServer({ name: 'local', version: '1.0.0' });

  server.registerTool('files_list', { description: `Lists a folder on the user's ${OS_NAME} (only where the user allowed).`, inputSchema: { path: z.string().max(1000) } }, ({ path }) => guard(() => listFolder(path), text));
  server.registerTool('files_read', { description: `Reads a text file or PDF on the user's ${OS_NAME} (only where the user allowed). Prefer this for PDFs instead of installing Python libraries.`, inputSchema: { path: z.string().max(1000) } }, ({ path }) =>
    guard(() => readText(path), (c) => text(untrusted(`File ${path}`, c))),
  );
  server.registerTool(
    'files_search',
    { description: "Finds files by name or content where the user allowed (their home folder when everything is allowed). Optional folder to look in.", inputSchema: { query: z.string().min(1).max(200), folder: z.string().max(1000).optional() } },
    ({ query, folder }) => guard(() => searchFiles(query, folder), (c) => text(untrusted(`Search for "${query}"`, c))),
  );
  server.registerTool(
    'files_write',
    { description: "Writes a text file where the user allowed. Needs the user's approval.", inputSchema: { path: z.string().max(1000), content: z.string().max(1_000_000) } },
    ({ path, content }) => guard(() => writeText(path, content), text),
  );

  server.registerTool(
    'shell_run',
    {
      description: `Runs a ${process.platform === 'win32' ? 'Windows PowerShell' : 'shell'} command on the user's ${OS_NAME}. Needs the user's approval, and the command must appear exactly, in its own \`\`\` block, in the approved text.`,
      inputSchema: { command: z.string().max(20_000), folder: z.string().max(1000).optional(), timeoutSeconds: z.number().int().min(1).max(600).optional() },
    },
    ({ command, folder, timeoutSeconds }) =>
      guard(async () => {
        on('shell');
        return runShell(command, folder, timeoutSeconds);
      }, (c) => text(untrusted('Command output', c))),
  );

  const web = <T>(fn: () => Promise<T>, ok: Parameters<typeof guard<T>>[1]) =>
    guard(async () => {
      on('browser');
      return fn();
    }, ok);

  server.registerTool(
    'browser_open',
    { description: "Opens a public web page in the user's own browser, signed in as the user. Use browser_read afterwards.", inputSchema: { url: z.string().max(2000) } },
    ({ url }) => {
      const c = checkBrowseUrl(url);
      if (!c.ok) return Promise.resolve(fail(c.reason));
      return web(() => browse('open', { url: c.url }), (r) => text(`Opened ${r.url} ("${r.title}"). Call browser_read to read the page.`));
    },
  );
  server.registerTool('browser_read', { description: "Reads the current page in the user's own browser: visible text and a numbered list of buttons, links and fields." }, () =>
    web(
      () => browse('read'),
      (r) => {
        const list = (r.elements ?? []).map((e) => `[${e.ref}] ${e.kind} "${e.label}"${e.href ? ` -> ${e.href}` : ''}${e.value ? ` (value: ${e.value})` : ''}`).join('\n');
        return text(untrusted(`Page "${r.title}" at ${r.url}, signed in as the user`, `Elements:\n${list || '(none)'}\n\nText:\n${r.text ?? ''}`.slice(0, 30_000)));
      },
    ),
  );
  server.registerTool('browser_screenshot', { description: "Takes a screenshot of the current page in the user's own browser." }, () =>
    web(
      () => browse('screenshot'),
      (r) => ({ content: [{ type: 'image', data: r.base64 ?? '', mimeType: r.mime ?? 'image/jpeg' }, { type: 'text', text: `Screenshot of "${r.title}" at ${r.url}` }] }),
    ),
  );
  server.registerTool(
    'browser_click',
    { description: "Clicks an element by its number from browser_read, as the user. Acts on a website, so it needs the user's approval.", inputSchema: { ref: z.number().int().min(1).max(500) } },
    ({ ref }) => web(() => browse('click', { ref }), (r) => text(`Clicked [${ref}]. Now at ${r.url} ("${r.title}"). Call browser_read to see the result.`)),
  );
  server.registerTool(
    'browser_type',
    { description: "Types into a field by its number from browser_read, as the user. Needs the user's approval.", inputSchema: { ref: z.number().int().min(1).max(500), text: z.string().max(5000), submit: z.boolean().optional() } },
    ({ ref, text: t, submit }) => web(() => browse('type', { ref, text: t, submit: Boolean(submit) }), (r) => text(`Typed into [${ref}]. Now at ${r.url}.`)),
  );
  server.registerTool(
    'browser_press',
    { description: "Presses a key in the user's own browser. Needs the user's approval.", inputSchema: { key: z.string().max(40) } },
    ({ key }) => web(() => browse('press', { key }), (r) => text(`Pressed ${key}. Now at ${r.url}.`)),
  );
  server.registerTool(
    'browser_reload_signins',
    { description: "Copies the user's browser sign-ins again. Call it after the user says they signed in to a site, then open the page again." },
    () => web(() => browse('signins'), () => text('Sign-ins reloaded. Open the page again.')),
  );
  server.registerTool(
    'browser_scroll',
    { description: "Scrolls the current page in the user's own browser. Positive pixels scrolls down, negative scrolls up. Use to reveal more content.", inputSchema: { pixels: z.number().int().min(-5000).max(5000).optional() } },
    ({ pixels }) => web(() => browse('scroll', { pixels }), (r) => text(`Scrolled. Still at ${r.url}. Call browser_read to see newly visible content.`)),
  );

  server.registerTool(
    'browser_ask_input',
    {
      description:
        "Asks the user for a password, one-time code or short text in a secure on-screen prompt (never in chat), then types it into a field by its number from browser_read. Use when a site needs a sign-in the user must enter. The value never reaches the model.",
      inputSchema: {
        ref: z.number().int().min(1).max(500),
        kind: z.enum(['password', 'text', 'otp']).default('password'),
        prompt: z.string().min(1).max(200),
        submit: z.boolean().optional(),
      },
    },
    ({ ref, kind, prompt, submit }) =>
      web(() => askAndFill({ target: 'local', kind: kind ?? 'password', prompt, ref, submit }), text),
  );
  server.registerTool(
    'browser_push_session',
    {
      inputSchema: { origin: z.string().url().describe('Destination origin, such as https://example.com') },
      description:
        "Copies the current sign-in cookies from this computer's ThreatDuet browser into Duet's cloud computer browser, so the cloud browser can use the same sessions. Call when work should continue on the Instabox machine.",
    },
    ({ origin }: { origin: string }) => web(() => pushSessionToComputer(origin), text),
  );
  return server;
}

export async function handleMacMcp(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await buildMacServer().connect(transport);
  return transport.handleRequest(req);
}
