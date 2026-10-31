import { Cron } from 'croner';
import { routines } from './duet.js';
import { notify } from './notify.js';
import { hhmm, inQuiet } from './policy.js';
import { db } from './store.js';
import type { UpcomingRoutine } from '../shared/types.js';

const today = () => new Date().toLocaleDateString('sv');
const REMIND_AFTER_MS = 3 * 3_600_000;

/**
 * Checked every minute rather than one cron job per routine, so settings changes apply
 * immediately and a brief missed while the machine was asleep still runs when it wakes.
 */
async function tick(): Promise<void> {
  const d = db.data;
  const s = d.settings;
  const t = hhmm(new Date());
  if (t >= s.briefAt && d.lastBrief !== today()) {
    d.lastBrief = today();
    routines.brief();
  }
  if (t >= s.reportAt && d.lastReport !== today()) {
    d.lastReport = today();
    routines.report();
  }
  const due = Date.now() - d.lastCheck >= s.checkEveryHours * 3_600_000;
  if (s.checkEveryHours > 0 && due && !inQuiet(t, s.quietStart, s.quietEnd)) {
    d.lastCheck = Date.now();
    routines.check();
  }

  for (const f of d.followups.filter((x) => x.at <= Date.now())) routines.followup(f.what);
  d.followups = d.followups.filter((x) => x.at > Date.now());

  // Nudge once about approvals that have been waiting a while.
  for (const m of d.messages) {
    const p = m.proposal;
    if (p?.status === 'pending' && !p.remindedAt && Date.now() - m.ts > REMIND_AFTER_MS) {
      p.remindedAt = Date.now();
      notify('Duet is still waiting for your approval', p.actions);
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
