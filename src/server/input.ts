import { randomUUID } from 'node:crypto';
import { stateChanged } from './events.js';
import { notify } from './notify.js';
import { tr } from './i18n.js';
import { resolvedRun } from './run-context.js';

export type InputKind = 'password' | 'text' | 'otp' | 'email' | 'username';

/** Shown in the UI; the value itself is never stored or put in chat. */
export interface PendingInput {
  id: string;
  kind: InputKind;
  /** Short reason shown to the user, e.g. "Sign in to GitHub". */
  prompt: string;
  /** Which browser the value will be typed into. */
  target: 'local' | 'computer';
  /** Element number from the last browser_read, when known. */
  ref?: number;
  /** Origin only; full paths can disclose sensitive navigation state. */
  origin?: string;
  taskId?: string;
  channel?: string;
  createdAt: number;
}

type Waiter = { input: PendingInput; resolve: (value: string | null) => void; promise: Promise<string | null>; key?: string; timer: NodeJS.Timeout; cleanup?: () => void };
const waiters = new Map<string, Waiter>();
const byField = new Map<string, string>();

const TIMEOUT_MS = 5 * 60_000;

export const openInputs = (): PendingInput[] => [...waiters.values()].map((w) => w.input);
export const openInput = (): PendingInput | null => openInputs()[0] ?? null;

function clear(id: string, result: string | null): void {
  const waiter = waiters.get(id);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  waiter.cleanup?.();
  waiters.delete(id);
  if (waiter.key && byField.get(waiter.key) === id) byField.delete(waiter.key);
  stateChanged();
  waiter.resolve(result);
}

/**
 * Asks the user for a secret or short value in the UI prompt and waits for it.
 * Returns the value, or null if they cancelled or it timed out. Never writes the value to disk or chat.
 */
export function requestInput(opts: {
  kind: InputKind;
  prompt: string;
  target: 'local' | 'computer';
  ref?: number;
  url?: string;
  taskId?: string;
  channel?: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const run = resolvedRun();
  const key = opts.ref == null ? undefined : `${opts.target}:${opts.taskId ?? run?.taskId ?? ''}:${opts.channel ?? run?.channel ?? ''}:${opts.ref}`;
  const existing = key && byField.get(key);
  if (existing && waiters.has(existing)) return waiters.get(existing)!.promise;
  const id = randomUUID();
  const input: PendingInput = {
    id,
    kind: opts.kind,
    prompt: opts.prompt.trim().slice(0, 200) || tr('Duet needs your input'),
    target: opts.target,
    ref: opts.ref,
    origin: opts.url ? (() => { try { return new URL(opts.url).origin; } catch { return undefined; } })() : undefined,
    taskId: opts.taskId ?? run?.taskId,
    channel: opts.channel ?? run?.channel,
    createdAt: Date.now(),
  };
  let resolve!: (value: string | null) => void;
  const promise = new Promise<string | null>((done) => { resolve = done; });
  const timer = setTimeout(() => clear(id, null), TIMEOUT_MS);
  waiters.set(id, { input, resolve, promise, key, timer });
  if (key) byField.set(key, id);
  const signal = opts.signal ?? run?.signal;
  if (signal) {
    if (signal.aborted) clear(id, null);
    else {
      const abort = () => clear(id, null);
      signal.addEventListener('abort', abort, { once: true });
      waiters.get(id)!.cleanup = () => signal.removeEventListener('abort', abort);
    }
  }
  stateChanged();
  notify(tr('Duet needs your input'), input.prompt);
  return promise;
}

/** The user submitted a value from the prompt. */
export function respondInput(id: string, value: string): boolean {
  if (!waiters.has(id)) return false;
  const v = value.slice(0, 5000);
  if (!v) return false;
  clear(id, v);
  return true;
}

/** The user dismissed the prompt, or a newer request replaced it. */
export function cancelInput(id: string): boolean {
  if (!waiters.has(id)) return false;
  clear(id, null);
  return true;
}

export function cancelInputs(filter: { taskId?: string; channel?: string; target?: 'local' | 'computer' } = {}): number {
  const ids = openInputs().filter((x) => (!filter.taskId || x.taskId === filter.taskId) && (!filter.channel || x.channel === filter.channel) && (!filter.target || x.target === filter.target)).map((x) => x.id);
  ids.forEach((id) => clear(id, null));
  return ids.length;
}
