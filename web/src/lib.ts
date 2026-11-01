import { useEffect, useState } from 'react';
import type { Kind, Message, ToolUse } from '../../src/shared/types';
import { locale, t, tn } from './i18n';

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** Whole days from ts to now: 0 today, 1 yesterday, -1 tomorrow. */
const daysAgo = (ts: number, now: number) => Math.round((startOfDay(new Date(now)) - startOfDay(new Date(ts))) / DAY);
const shortDate = (ts: number) => new Date(ts).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });

export const clock = (ts: number) => new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

/** "Today", "Yesterday", "Tomorrow", else "Thursday 29 October". */
export function dayLabel(ts: number, now = Date.now()): string {
  const diff = daysAgo(ts, now);
  if (diff === 0) return t('Today');
  if (diff === 1) return t('Yesterday');
  if (diff === -1) return t('Tomorrow');
  return new Date(ts).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Upcoming time split for a narrow column: day (omitted for today) above the clock time. */
export function whenParts(ts: number, now = Date.now()): { day: string | null; time: string } {
  if (ts <= now + 60_000) return { day: null, time: t('Now') };
  const diff = daysAgo(ts, now);
  if (diff === 0) return { day: null, time: clock(ts) };
  if (diff === -1) return { day: t('Tomorrow'), time: clock(ts) };
  return { day: shortDate(ts), time: clock(ts) };
}

/** The same moment as a phrase inside a sentence: "now", "at 16:00", "tomorrow at 08:00", "on Sun 1 Nov at 19:00". */
export function whenPhrase(ts: number, now = Date.now()): string {
  if (ts <= now + 60_000) return t('now');
  const diff = daysAgo(ts, now);
  if (diff === 0) return t('at {time}', { time: clock(ts) });
  if (diff === -1) return t('tomorrow at {time}', { time: clock(ts) });
  return t('on {date} at {time}', { date: shortDate(ts), time: clock(ts) });
}

export function groupByDay(messages: Message[]): { label: string; items: Message[] }[] {
  const groups: { label: string; items: Message[] }[] = [];
  for (const m of messages) {
    const label = dayLabel(m.ts);
    if (groups.at(-1)?.label === label) groups.at(-1)!.items.push(m);
    else groups.push({ label, items: [m] });
  }
  return groups;
}

// Getters, so the titles follow the current language.
export const KIND_TITLE: Partial<Record<Kind, string>> = {
  get brief() { return t('Morning brief'); },
  get check() { return t('Check-in'); },
  get report() { return t('Evening report'); },
  get followup() { return t('Follow-up'); },
  get done() { return t('Task finished'); },
};

export const ROUTINE_TITLE = {
  get brief() { return t('Morning brief'); },
  get report() { return t('Evening report'); },
  get check() { return t('Check-in'); },
};

/** Tool titles arrive as paths relative to the user's home or project; keep the part inside the workspace. */
export function workspacePath(title: string): string {
  const i = title.lastIndexOf('workspace/');
  return i >= 0 ? title.slice(i + 'workspace/'.length) : title.replace(/^\/+/, '');
}

const BUILT_IN = new Set(['read', 'write', 'edit', 'glob', 'grep', 'list', 'webfetch', 'websearch', 'codesearch', 'todowrite', 'todoread', 'skill', 'invalid']);

/** Turns raw tool calls into what the user cares about: files Duet produced, and what it looked at. */
export function summarizeTools(tools: ToolUse[] = []): { files: string[]; notes: string[] } {
  const done = tools.filter((t) => t.status === 'completed');
  const files = [
    ...new Set(done.filter((t) => t.tool === 'write' || t.tool === 'edit').map((t) => workspacePath(t.title ?? '')).filter(Boolean)),
  ];
  const count = (...names: string[]) => done.filter((t) => names.includes(t.tool)).length;
  const notes: string[] = [];
  if (count('read')) notes.push(tn(count('read'), 'read {n} file', 'read {n} files'));
  if (count('glob', 'grep', 'list')) notes.push(t('searched the workspace'));
  if (count('websearch')) notes.push(t('searched the web'));
  if (count('webfetch')) notes.push(tn(count('webfetch'), 'opened {n} web page', 'opened {n} web pages'));
  const apps = new Set(done.filter((t) => !BUILT_IN.has(t.tool) && t.tool.includes('_') && !t.tool.startsWith('kilo_')).map((t) => t.tool.split('_')[0]));
  // 'mac' is the old name of the user's own computer, in messages from before 0.2.8.
  for (const app of apps) notes.push(app === 'computer' ? t('used its computer') : app === 'local' || app === 'mac' ? t('used your computer') : t('used {app}', { app }));
  if (notes.length) notes[0] = notes[0][0].toUpperCase() + notes[0].slice(1);
  return { files, notes };
}

/** First meaningful line of a proposal, for lists. */
export function proposalHeadline(actions: string): string {
  const line = actions.split('\n').map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '').trim()).find(Boolean) ?? actions;
  return line.replace(/[`*_]/g, '');
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
export const countWord = (n: number) => (WORDS[n] ? t(WORDS[n]) : String(n));

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;


/** Reactive media query, for layout decisions CSS alone can't make (which sheet, which panel). */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** Spring used for every state change in the UI, or instant under reduced motion. */
export const spring = (reduce: boolean | null) =>
  reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 380, damping: 34, mass: 0.8 };
