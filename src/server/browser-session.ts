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
}): Promise<string> {
  if (opts.target === 'local' && !db.data.mac.browser) {
    throw new Error(tr('The browser on this computer is turned off. Turn it on in the Your Mac / Your PC panel.'));
  }
  if (opts.target === 'computer' && !db.data.computer) {
    throw new Error(tr('No computer is connected.'));
  }

  // Read the page first so the prompt can show where we are.
  const page = opts.target === 'local' ? await browse('read') : await computerBrowser('read');
  const value = await requestInput({
    kind: opts.kind,
    prompt: opts.prompt,
    target: opts.target,
    ref: opts.ref,
    url: page.url,
  });
  if (value == null) throw new Error(tr('The user cancelled or the prompt timed out.'));

  if (opts.target === 'local') {
    await browse('type', { ref: opts.ref, text: value, submit: Boolean(opts.submit) });
  } else {
    await computerBrowser('type', { ref: opts.ref, text: value, submit: Boolean(opts.submit) });
  }
  // Never echo the value.
  return opts.kind === 'password'
    ? tr('Password entered into [{ref}]. Call browser_read to see the result.', { ref: opts.ref })
    : tr('Entered into [{ref}]. Call browser_read to see the result.', { ref: opts.ref });
}

/** Move the local OpenDuet browser session (cookies) onto Duet's Instabox Chromium. */
export async function pushSessionToComputer(): Promise<string> {
  if (!db.data.mac.browser) throw new Error(tr('The browser on this computer is turned off. Turn it on in the Your Mac / Your PC panel.'));
  if (!db.data.computer) throw new Error(tr('No computer is connected.'));
  const cookies = await exportCookies();
  if (!cookies.length) throw new Error(tr('No sign-ins in the local OpenDuet browser yet. Open a page or reload sign-ins first.'));
  const { count } = await importSessionCookies(cookies);
  return tr("Copied {n} sign-in cookies to Duet's computer. Open the site there to use the session.", { n: count });
}
