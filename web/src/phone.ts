import { App as CapApp } from '@capacitor/app';
import { BackgroundRunner } from '@capacitor/background-runner';
import type { StateResponse } from '../../src/shared/types';
import { parsePairLink, type Connection } from './connection';
import { t } from './i18n';

/** Must match plugins.BackgroundRunner.label in capacitor.config.ts. */
export const RUNNER = 'tech.threatvector.threatduet.check';

/** Checks a connection works before saving it, with errors that say what to do. */
export async function verifyConnection(c: Connection): Promise<StateResponse> {
  const unreachable = t("Can't reach {url}. Check that ThreatDuet is running on your computer and that both devices are on Tailscale or the same network.", { url: c.url });
  let res: Response;
  try {
    // Native HTTP may ignore AbortSignal, so race it against a timer instead.
    res = await Promise.race([
      fetch(`${c.url}/api/state`, { headers: { authorization: `Bearer ${c.token}` } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15_000)),
    ]);
  } catch {
    throw new Error(unreachable);
  }
  if (res.status === 401)
    throw new Error(t("The pairing code doesn't match. On your computer, open Settings, then Phone, and scan the code again."));
  if (!res.ok) throw new Error(t('Your computer answered with an error ({status}). Try again in a moment.', { status: res.status }));
  return res.json();
}

/** Hands the connection to the background check that runs while the app is closed. */
export async function configureBackground(c: Connection | null, seenTs = 0): Promise<void> {
  await BackgroundRunner.dispatchEvent({
    label: RUNNER,
    event: 'configure',
    details: c ? { url: c.url, token: c.token, seenTs } : {},
  });
}

/** Whether the app is in the foreground. A WebView in the recent-apps list may keep running JS. */
export async function appIsActive(): Promise<boolean> {
  try {
    return (await CapApp.getState()).isActive;
  } catch {
    return !document.hidden;
  }
}

/** Tells the background check what the user has already seen, so it doesn't notify about it. */
export async function markSeen(seenTs: number): Promise<void> {
  await BackgroundRunner.dispatchEvent({ label: RUNNER, event: 'seen', details: { seenTs } });
}

export async function askForNotifications(): Promise<void> {
  await BackgroundRunner.requestPermissions({ apis: ['notifications'] });
}

/** Pairing links come from scanning the QR code with the phone camera, at launch or while running. */
export function onPairLink(handler: (c: Connection) => void): () => void {
  void CapApp.getLaunchUrl().then((r) => {
    const c = r?.url ? parsePairLink(r.url) : null;
    if (c) handler(c);
  });
  const sub = CapApp.addListener('appUrlOpen', ({ url }) => {
    const c = parsePairLink(url);
    if (c) handler(c);
  });
  return () => void sub.then((s) => s.remove());
}
