import { requestInput, type InputKind } from './input.js';
import { browse, exportCookies } from './mac/browser.js';
import { browser as computerBrowser, importSessionCookies } from './computer/machine.js';
import { db } from './store.js';
import { tr } from './i18n.js';

/** Ask the user for a value in the secure prompt, then type it into a browser field. The value never enters chat. */
export async function askAndFill(opts: {
  target: 'local' | 'computer';
  kind: InputKind;
  prompt: string;
  ref: number;
  submit?: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  if (opts.target === 'local' && !db.data.mac.browser) {
    throw new Error(tr('The browser on this computer is turned off. Turn it on in the Your Mac / Your PC panel.'));
  }
  if (opts.target === 'computer' && !db.data.computer && !db.data.cloudBroker) {
    throw new Error(tr('No computer is connected.'));
  }

  // Read the page first so the prompt can show where we are.
  const page = opts.target === 'local' ? await browse('read') : await computerBrowser('read');
  const binding = opts.target === 'local'
    ? await browse('inspect-input', { ref: opts.ref })
    : await computerBrowser('inspect-input', { ref: opts.ref });
  if (!binding.token) throw new Error(tr('The page changed while waiting for input. Read the page again and request a fresh prompt.'));
  if (binding.url !== page.url || !/^https?:$/.test(new URL(binding.url!).protocol)) throw new Error('Credential destination changed. Inspect the page again.');
  const value = await requestInput({
    kind: binding.kind ?? opts.kind,
    prompt: opts.prompt,
    target: opts.target,
    ref: opts.ref,
    url: page.url,
    signal: opts.signal,
  });
  if (value == null) throw new Error(tr('The user cancelled or the prompt timed out.'));

  const fill = { ref: opts.ref, token: binding.token, url: binding.url, text: value, submit: Boolean(opts.submit) };
  if (opts.target === 'local') await browse('fill-input', fill);
  else await computerBrowser('fill-input', fill);
  // Never echo the value.
  return opts.kind === 'password'
    ? tr('Password entered into [{ref}]. Call browser_read to see the result.', { ref: opts.ref })
    : tr('Entered into [{ref}]. Call browser_read to see the result.', { ref: opts.ref });
}

/** Move the local ThreatDuet browser session (cookies) onto Duet's Instabox Chromium. */
export async function pushSessionToComputer(origin: string): Promise<string> {
  let destination: URL;
  try { destination = new URL(origin); } catch { throw new Error(tr('A valid destination origin is required.')); }
  if (destination.username || destination.password) throw new Error(tr('Destination origin cannot contain credentials.'));
  if (!/^https?:$/.test(destination.protocol) || destination.pathname !== '/' || destination.search || destination.hash) throw new Error(tr('Use destination origin only, such as https://example.com.'));
  if (!db.data.mac.browser) throw new Error(tr('The browser on this computer is turned off. Turn it on in the Your Mac / Your PC panel.'));
  if (!db.data.computer && !db.data.cloudBroker) throw new Error(tr('No computer is connected.'));
  const cookies = await exportCookies(destination.origin);
  if (!cookies.length) throw new Error(tr('No sign-ins in the local ThreatDuet browser yet. Open a page or reload sign-ins first.'));
  const { count } = await importSessionCookies(cookies);
  return tr("Copied {n} sign-in cookies to Duet's computer. Open the site there to use the session.", { n: count });
}
