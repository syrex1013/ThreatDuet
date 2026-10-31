import notifier from 'node-notifier';
import { db } from './store.js';
import { hhmm, inQuiet } from './policy.js';
import { log } from './config.js';

export type Notifier = (title: string, message: string) => void;

let deliver: Notifier = (title, message) =>
  notifier.notify({ title, message }, (err) => {
    if (err) log.warn({ err }, 'desktop notification failed');
  });

/** The desktop app swaps in native notifications that open its window when clicked. */
export function setNotifier(fn: Notifier): void {
  deliver = fn;
}

export function notify(title: string, message: string): void {
  const { quietStart, quietEnd } = db.data.settings;
  if (inQuiet(hhmm(new Date()), quietStart, quietEnd)) return;
  deliver(title, message.slice(0, 200) || title);
}
