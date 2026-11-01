import { ChevronRight, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { RoutineItem, StateResponse, TaskItem, TaskStatus } from '../../../src/shared/types';
import { isPhone } from '../connection';
import { t, tn } from '../i18n';
import { clock, countWord, dayLabel, proposalHeadline, ROUTINE_TITLE, spring, whenParts, whenPhrase } from '../lib';

interface PanelProps {
  state: StateResponse;
  onJump: (messageId: string) => void;
  onCancelFollowup: (id: string) => void;
  onToggleRoutine: (id: string, enabled: boolean) => void;
  onDeleteRoutine: (id: string) => void;
  /** Connected apps on this computer; null on the phone, where apps aren't managed. */
  appsCount?: number | null;
  onOpenApps?: () => void;
  onStartTask: (id: string) => void;
  onDismissTask: (id: string) => void;
}

const OPEN_ORDER: Partial<Record<TaskStatus, number>> = { running: 0, queued: 1, suggested: 2 };

/** Done or failed, today as a time, earlier as a day. */
function finishedAt(ts: number): string {
  const day = dayLabel(ts);
  return day === t('Today') ? clock(ts) : day;
}

export function TaskList({ tasks, onStart, onDismiss }: { tasks: TaskItem[]; onStart: (id: string) => void; onDismiss: (id: string) => void }) {
  // Cached state from an older server has no tasks.
  const open = tasks.filter((x) => x.status in OPEN_ORDER).sort((a, b) => OPEN_ORDER[a.status]! - OPEN_ORDER[b.status]!);
  const finished = tasks
    .filter((x) => x.status === 'done' || x.status === 'failed')
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
    .slice(0, 3);
  if (!open.length && !finished.length) return <p className="tasks-empty">{t('Duet will come up with tasks as it learns about your work.')}</p>;
  const label: Partial<Record<TaskStatus, string>> = { running: t('Working on it'), queued: t('Up next'), suggested: t('Suggested') };
  return (
    <ul className="upcoming tasks">
      {open.map((x) => (
        <li key={x.id} className={`task task-${x.status}`}>
          <span className="upcoming-when">
            {x.status === 'running' && <span className="pulse" aria-hidden="true" />}
            {label[x.status]}
          </span>
          <div className="task-body">
            {x.details ? (
              <details>
                <summary>{x.title}</summary>
                <p className="task-details">{x.details}</p>
              </details>
            ) : (
              <span className="task-title">{x.title}</span>
            )}
            {x.status !== 'running' && (
              <span className="task-actions">
                {x.status === 'suggested' && (
                  <button type="button" className="btn btn-send btn-sm" onClick={() => onStart(x.id)} aria-label={t('Do it: {what}', { what: x.title })}>
                    {t('Do it')}
                  </button>
                )}
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => onDismiss(x.id)} aria-label={`${x.status === 'suggested' ? t('Dismiss') : t('Cancel')}: ${x.title}`}>
                  {x.status === 'suggested' ? t('Dismiss') : t('Cancel')}
                </button>
              </span>
            )}
          </div>
        </li>
      ))}
      {finished.map((x) => (
        <li key={x.id} className={`task task-finished task-${x.status}`}>
          <span className="upcoming-when">
            <span className="upcoming-day">{x.doneAt ? finishedAt(x.doneAt) : ''}</span>
            {x.status === 'done' ? t('Done') : t('Failed')}
          </span>
          <span className="upcoming-what" title={x.title}>
            {x.title}
          </span>
        </li>
      ))}
    </ul>
  );
}

// English spells small counts out ({count}); the Polish forms use the digit ({n}).
function headline(state: StateResponse): string {
  const n = state.messages.filter((m) => m.proposal?.status === 'pending').length;
  return n === 0
    ? t('Nothing needs you right now.')
    : tn(n, '{count} thing needs your approval.', '{count} things need your approval.', { count: countWord(n) });
}

// Cached state from an older server has no channels.
const channelName = (state: StateResponse, id?: string) => {
  const c = id && state.channels?.find((x) => x.id === id);
  return c ? `#${c.name} · ` : '';
};

function upcomingOf(state: StateResponse) {
  return [
    ...state.upcoming.map((r) => ({ key: r.kind, at: r.at, label: ROUTINE_TITLE[r.kind], followupId: null as string | null, routine: null as RoutineItem | null })),
    ...state.followups.map((f) => ({ key: f.id, at: f.at, label: f.what, followupId: f.id, routine: null })),
    // Cached state from an older server has no routines.
    ...(state.routines ?? []).flatMap((r) => (r.nextAt === null ? [] : [{ key: r.id, at: r.nextAt, label: r.what, followupId: null, routine: r as RoutineItem }])),
  ].sort((a, b) => a.at - b.at);
}

function subline(state: StateResponse): string {
  if (state.busy) {
    const busy = t(state.busy);
    return state.busyDetail ? t('Duet is {busy}: {detail}.', { busy, detail: state.busyDetail }) : t('Duet is {busy}.', { busy });
  }
  const next = upcomingOf(state).find((u) => u.routine?.enabled !== false);
  if (!next) return t('Duet is idle.');
  const when = whenPhrase(next.at);
  if (next.followupId) return t('Next up: a follow-up {when}.', { when });
  if (next.routine) return t('Next up: a routine {when}.', { when });
  return t('Next up: the {what} {when}.', { what: t(next.label).toLowerCase(), when });
}

/** Duet speaks first: what needs you, what it is doing, what comes next. */
export function Panel({ state, onJump, onCancelFollowup, onToggleRoutine, onDeleteRoutine, appsCount, onOpenApps, onStartTask, onDismissTask }: PanelProps) {
  const reduce = useReducedMotion();
  const pending = state.messages.filter((m) => m.proposal?.status === 'pending');
  const upcoming = upcomingOf(state);
  const title = headline(state);
  const computerState = (s: string | null) => (s === 'running' ? t('awake') : s === 'suspended' || s === 'stopped' ? t('asleep') : t('not checked yet'));

  return (
    <div className="panel">
      <div className="status-block" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.h1
            key={title}
            className="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={spring(reduce)}
          >
            {title}
          </motion.h1>
        </AnimatePresence>
        <p className="status-sub">
          {state.busy && <span className="pulse" aria-hidden="true" />}
          {subline(state)}
        </p>
        {state.computer && (
          <p className="status-sub computer-line">
            {t('Its computer, {name}: {state}.', { name: state.computer.name, state: computerState(state.computer.state) })}
          </p>
        )}
      </div>

      <AnimatePresence initial={false}>
        {pending.length > 0 && (
          <motion.section
            key="needs"
            className="panel-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring(reduce)}
          >
            <h2>{t('Needs you')}</h2>
            <ul className="needs">
              {pending.map((m) => (
                <li key={m.id}>
                  <button type="button" className="need" onClick={() => onJump(m.id)}>
                    <span className="need-text">{proposalHeadline(m.proposal!.actions)}</span>
                    <span className="need-time">
                      {channelName(state, m.channel)}
                      {t('Asked at {time}', { time: clock(m.ts) })}
                    </span>
                    <ChevronRight size={16} className="need-go" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </motion.section>
        )}
      </AnimatePresence>

      {appsCount === 0 && onOpenApps && (
        <button type="button" className="nudge" onClick={onOpenApps}>
          <span className="nudge-title">{t('Connect your apps')}</span>
          <span className="nudge-text">{t('Let Duet watch your email, calendar and tasks, and come to you when something needs you.')}</span>
        </button>
      )}

      <section className="panel-section">
        <h2>{t("Duet's tasks")}</h2>
        <TaskList tasks={state.tasks ?? []} onStart={onStartTask} onDismiss={onDismissTask} />
      </section>

      <section className="panel-section">
        <h2>{t('Coming up')}</h2>
        <ul className="upcoming">
          {upcoming.map((u) => {
            const { day, time } = whenParts(u.at);
            const r = u.routine;
            const label = r || u.followupId ? u.label : t(u.label);
            return (
              <li key={u.key} className={r && !r.enabled ? 'routine-off' : undefined}>
                <span className="upcoming-when">
                  {day && <span className="upcoming-day">{day}</span>}
                  {time}
                </span>
                <span className="upcoming-what" title={label}>
                  {u.followupId
                    ? t('Follow-up: {what}', { what: label })
                    : r
                      ? r.enabled
                        ? t('Routine: {what}', { what: label })
                        : t('Suggested, off: {what}', { what: label })
                      : label}
                </span>
                {r && (
                  <span className="routine-controls">
                    <label className="check check-inline" title={isPhone && !r.enabled ? t('Turn routines on from your computer') : undefined}>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={isPhone && !r.enabled}
                        onChange={(e) => onToggleRoutine(r.id, e.target.checked)}
                      />
                      <span>{t('On')}</span>
                    </label>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      onClick={() => onDeleteRoutine(r.id)}
                      aria-label={t('Delete routine: {what}', { what: label })}
                      title={t('Delete routine')}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </span>
                )}
                {u.followupId && (
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    onClick={() => onCancelFollowup(u.followupId!)}
                    aria-label={t('Cancel follow-up: {what}', { what: label })}
                    title={t('Cancel follow-up')}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {state.digestCount > 0 && (
          <p className="held">
            {tn(state.digestCount, '{count} thing that can wait, saved for your next brief.', '{count} things that can wait, saved for your next brief.', {
              count: countWord(state.digestCount),
            })}
          </p>
        )}
      </section>
    </div>
  );
}

/** Phone and narrow windows: one line that opens the full panel. */
export function StatusStrip({ state, onOpen }: { state: StateResponse; onOpen: () => void }) {
  const pending = state.messages.some((m) => m.proposal?.status === 'pending');
  return (
    <button type="button" className={`strip ${pending ? 'has-pending' : ''}`} onClick={onOpen} aria-label={t("Status and what's coming up")}>
      <span className="strip-main">
        <span className="strip-title">{headline(state)}</span>
        <span className="strip-sub">
          {state.busy && <span className="pulse" aria-hidden="true" />}
          {subline(state)}
        </span>
      </span>
      <ChevronRight size={18} aria-hidden="true" />
    </button>
  );
}
