import { Cron } from 'croner';
import { queuedTasks, routines, runTask } from './duet.js';
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
  for (const id of queuedTasks()) runTask(id);
  daily('brief', s.briefAt, t);
  daily('report', s.reportAt, t);
  const now = Date.now();
  const due = now - d.lastCheck >= s.checkEveryHours * 3_600_000;
  if (s.checkEveryHours > 0 && due && !inQuiet(t, s.quietStart, s.quietEnd)) {
    d.lastCheck = now;
    routines.check();
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
  return new Cron('* * * * *', { protect: true }, tick);
}
