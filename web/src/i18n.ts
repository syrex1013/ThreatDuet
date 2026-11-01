import type { Language } from '../../src/shared/types';
import { PL_WORK } from './locales/pl-work';
import { PL_APP } from './locales/pl-app';
import { PL_APPS } from './locales/pl-apps';
import { PL_COMPUTER } from './locales/pl-computer';
import { PL_THREAD } from './locales/pl-thread';

/** English text is the key; a missing translation shows the English. */
const PL: Record<string, string> = { ...PL_APP, ...PL_THREAD, ...PL_APPS, ...PL_COMPUTER, ...PL_WORK };

// Until the settings arrive (pairing screen, first paint), follow the system language.
let lang: Language = typeof navigator !== 'undefined' && /^pl\b/i.test(navigator.language) ? 'pl' : 'en';

export function setLanguage(l: Language): void {
  lang = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

export const language = () => lang;

/** For toLocale* and speech recognition. */
export const locale = () => (lang === 'pl' ? 'pl-PL' : undefined);

const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/** t('{n} waiting', { n: 2 }): the translation for the current language, with {name} placeholders filled in. */
export function t(en: string, vars?: Record<string, string | number>): string {
  return fill((lang === 'pl' && PL[en]) || en, vars);
}

/**
 * Counted text: tn(n, '{n} app', '{n} apps'). The Polish entry, keyed by the English plural, holds the
 * three forms 'one|few|many' (1 aplikacja | 2 aplikacje | 5 aplikacji).
 */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  const v = { n, ...vars };
  const forms = lang === 'pl' ? PL[many]?.split('|') : undefined;
  if (!forms || forms.length !== 3) return fill(n === 1 ? one : many, v);
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
  return fill(n === 1 ? forms[0] : few ? forms[1] : forms[2], v);
}
