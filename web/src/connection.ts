import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/** Where the phone app finds Duet: the computer's phone-access address and its pairing token. */
export interface Connection {
  url: string;
  token: string;
}

/** True inside the Android app. The desktop app and the browser talk to the local server directly. */
export const isPhone = Capacitor.isNativePlatform();

const KEY = 'connection';
let current: Connection | null = null;

export async function loadConnection(): Promise<Connection | null> {
  if (!isPhone) return null;
  const { value } = await Preferences.get({ key: KEY });
  current = value ? (JSON.parse(value) as Connection) : null;
  return current;
}

export const connection = () => current;

export async function saveConnection(c: Connection | null): Promise<void> {
  current = c;
  if (c) await Preferences.set({ key: KEY, value: JSON.stringify(c) });
  else await Preferences.remove({ key: KEY });
}

export const apiUrl = (path: string) => `${current?.url ?? ''}/api${path}`;
export const authHeaders = (): Record<string, string> => (current ? { authorization: `Bearer ${current.token}` } : {});

/** Builds the link the computer shows as a QR code; the phone's camera opens it in the app. */
export const pairLink = (url: string, token: string) =>
  `openduet://pair?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;

export function parsePairLink(link: string): Connection | null {
  try {
    const u = new URL(link);
    if (u.protocol !== 'openduet:') return null;
    const url = normalizeUrl(u.searchParams.get('url') ?? '');
    const token = u.searchParams.get('token') ?? '';
    return url && token ? { url, token } : null;
  } catch {
    return null;
  }
}

/** Accepts "100.77.1.2:4320" or a full URL; returns "http://host:port" without a trailing slash. */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}
