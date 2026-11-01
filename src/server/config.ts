import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import type { Settings } from '../shared/types.js';

// OPENDUET_HOME holds data/ and workspace/. The desktop app points it at the OS app-data folder.
export const ROOT = path.resolve(process.env.OPENDUET_HOME ?? process.cwd());
export const DATA_DIR = path.join(ROOT, 'data');
export const WORKSPACE = path.join(ROOT, 'workspace');
export const STATE_FILE = path.join(DATA_DIR, 'state.json');
export const MEMORY_FILE = path.join(DATA_DIR, 'memory.md');
// Kilo config holding the connected apps (and any API keys): private, outside the agent's workspace.
export const CONNECTORS_FILE = path.join(DATA_DIR, 'kilo-connectors.json');
// The built UI ships next to the compiled server (dist/server -> web/dist), wherever the app is installed.
// Where Duet works on its cloud computer, and where the browser driver lives there.
export const VM_WORK_DIR = '/data/workspace/openduet';
export const VM_DRIVER_DIR = '/data/home/openduet';
export const WEB_DIST = process.env.OPENDUET_WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
export const PORT = Number(process.env.PORT ?? 4317);
export const HOST = '127.0.0.1';
export const REMOTE_PORT = Number(process.env.OPENDUET_REMOTE_PORT ?? 4320);
export const RUN_TIMEOUT_MS = 15 * 60 * 1000;

export const DEFAULT_SETTINGS: Settings = {
  model: 'nim/nvidia/nemotron-3-ultra-550b-a55b',
  briefAt: '08:00',
  reportAt: '18:00',
  checkEveryHours: 3,
  quietStart: '22:00',
  quietEnd: '07:00',
  focus: 'Anything urgent, mistakes or conflicts in my schedule, messages waiting on me, unpaid invoices.',
  openWebPages: false,
  kiloMode: 'api',
  language: 'en',
};

export const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
