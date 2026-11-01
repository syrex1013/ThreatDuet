import { queueWatches } from './watches.js';
import { Cron } from 'croner';
import { currentWork, queuedTasks, routines, runTask } from './duet.js';
import { notify } from './notify.js';
import { tr } from './i18n.js';
import { nextRoutineRun } from './parse.js';
import { hhmm, inQuiet } from './policy.js';
import { db } from './store.js';
import type { RoutineItem, UpcomingRoutine } from '../shared/types.js';

const today = () => new Date().toLocaleDateString('sv');
const REMIND_AFTER_MS = 3 * 3_600_000;
const MAX_TRIES = 3;
const RETRY_GAP_MS = 15 * 60_000;
/** Counted from the last run (or turning on), so a slot missed while asleep or restarting runs once on wake. */
export const routineDue = (r: RoutineItem) => nextRoutineRun(r.cron, new Date(r.lastRun ?? r.createdAt));
const tries = { brief: { day: '', n: 0, next: 0 }, report: { day: '', n: 0, next: 0 } };

/** Marks the routine done for today when queued; if nothing was delivered, it is retried a few times, spaced out. */
function daily(kind: 'brief' | 'report', at: string, t: string): void {
  const key = kind === 'brief' ? 'lastBrief' : 'lastReport';
  const r = tries[kind];
  if (r.day !== today()) Object.assign(r, { day: today(), n: 0, next: 0 });
  if (t < at || db.data[key] === today() || Date.now() < r.next) return;
  const prev = db.data[key];
  db.data[key] = today();
  r.n++;
  r.next = Date.now() + RETRY_GAP_MS;
  // The last try's failure stands, so an offline machine doesn't run kilo all day.
  if (r.n >= MAX_TRIES) return void routines[kind]();
  routines[kind](async () => {
    if (db.data[key] !== today()) return;
    db.data[key] = prev;
    await db.write();
  });
}

/**
 * Checked every minute rather than one cron job per routine, so settings changes apply
 * immediately and a brief missed while the machine was asleep still runs when it wakes.
 */
export async function tick(): Promise<void> {
  const d = db.data;
  // Nothing runs on its own until the user has set Duet up (or skipped setup).
  if (!d.setupDone) return;
  const s = d.settings;
  const t = hhmm(new Date());
  queueWatches();
  for (const id of queuedTasks()) runTask(id);
  daily('brief', s.briefAt, t);
  daily('report', s.reportAt, t);
  const now = Date.now();
  const due = now - d.lastCheck >= s.checkEveryHours * 3_600_000;
  if (s.checkEveryHours > 0 && due && !inQuiet(t, s.quietStart, s.quietEnd)) {
    d.lastCheck = now;
    routines.check();
  }

  // Recommendations: soon after the app starts, then at a random time, never while Duet is busy or in quiet hours.
  if (d.recs.nextAt && now >= d.recs.nextAt && !currentWork() && !inQuiet(t, s.quietStart, s.quietEnd)) {
    d.recs.nextAt = nextRecsAt(now, s.quietStart, s.quietEnd);
    routines.recommend();
  }

  for (const f of d.followups) if (f.at <= now) routines.followup(f);
  // The user picked the time, so routines run inside quiet hours too.
  for (const r of d.routines) {
    const next = r.enabled ? routineDue(r) : null;
    if (next !== null && next <= now) routines.routine(r.id);
  }

  // Nudge once about approvals that have been waiting a while.
  for (const m of d.messages) {
    const p = m.proposal;
    if (p?.status === 'pending' && !p.remindedAt && now - m.ts > REMIND_AFTER_MS && !inQuiet(t, s.quietStart, s.quietEnd)) {
      p.remindedAt = now;
      notify(tr('Duet is still waiting for your approval'), p.actions);
    }
  }
  await db.write();
}

/** The next recommendations: a random time 3 to 8 hours on, moved to just after quiet hours if it falls inside them. */
export function nextRecsAt(now: number, quietStart: string, quietEnd: string, rand = Math.random): number {
  const at = now + (3 + rand() * 5) * 3_600_000;
  if (!inQuiet(hhmm(new Date(at)), quietStart, quietEnd)) return at;
  const [h, m] = quietEnd.split(':').map(Number);
  const end = new Date(at);
  end.setHours(h, m, 0, 0);
  if (end.getTime() <= at) end.setDate(end.getDate() + 1);
  return end.getTime() + rand() * 3_600_000;
}

/** When each routine will next run, for the UI. A time in the past means "within the minute". */
export function upcomingRoutines(): UpcomingRoutine[] {
  const d = db.data;
  const s = d.settings;
  const at = (time: string, doneToday: boolean) => {
    const [h, m] = time.split(':').map(Number);
    const x = new Date();
    x.setHours(h, m, 0, 0);
    if (doneToday) x.setDate(x.getDate() + 1);
    return x.getTime();
  };
  const out: UpcomingRoutine[] = [
    { kind: 'brief', at: at(s.briefAt, d.lastBrief === today()) },
    { kind: 'report', at: at(s.reportAt, d.lastReport === today()) },
  ];
  if (s.checkEveryHours > 0) {
    let next = Math.max(Date.now(), d.lastCheck + s.checkEveryHours * 3_600_000);
    if (inQuiet(hhmm(new Date(next)), s.quietStart, s.quietEnd)) {
      const end = at(s.quietEnd, false);
      next = end > next ? end : end + 86_400_000;
    }
    out.push({ kind: 'check', at: next });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function startScheduler(): Cron {
  // Every start offers recommendations a minute in.
  db.data.recs.nextAt = Date.now() + 60_000;
  return new Cron('* * * * *', { protect: true }, tick);
}
