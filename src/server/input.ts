import { randomUUID } from 'node:crypto';
import { stateChanged } from './events.js';
import { notify } from './notify.js';
import { tr } from './i18n.js';

export type InputKind = 'password' | 'text' | 'otp';

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
  url?: string;
  createdAt: number;
}

type Waiter = { resolve: (value: string | null) => void; timer: NodeJS.Timeout };

let pending: PendingInput | null = null;
let waiter: Waiter | null = null;

const TIMEOUT_MS = 5 * 60_000;

export const openInput = (): PendingInput | null => pending;

function clear(result: string | null): void {
  if (waiter) {
    clearTimeout(waiter.timer);
    const { resolve } = waiter;
    waiter = null;
    pending = null;
    stateChanged();
    resolve(result);
  } else {
    pending = null;
    stateChanged();
  }
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
}): Promise<string | null> {
  if (pending) clear(null);
  const id = randomUUID();
  pending = {
    id,
    kind: opts.kind,
    prompt: opts.prompt.trim().slice(0, 200) || tr('Duet needs your input'),
    target: opts.target,
    ref: opts.ref,
    url: opts.url,
    createdAt: Date.now(),
  };
  stateChanged();
  notify(tr('Duet needs your input'), pending.prompt);
  return new Promise((resolve) => {
    waiter = {
      resolve,
      timer: setTimeout(() => clear(null), TIMEOUT_MS),
    };
  });
}

/** The user submitted a value from the prompt. */
export function respondInput(id: string, value: string): boolean {
  if (!pending || pending.id !== id || !waiter) return false;
  const v = value.slice(0, 5000);
  if (!v) return false;
  clear(v);
  return true;
}

/** The user dismissed the prompt, or a newer request replaced it. */
export function cancelInput(id: string): boolean {
  if (!pending || pending.id !== id) return false;
  clear(null);
  return true;
}
