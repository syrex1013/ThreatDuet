import { ChevronRight, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { RoutineItem, StateResponse } from '../../../src/shared/types';
import { isPhone } from '../connection';
import { clock, countWord, proposalHeadline, ROUTINE_TITLE, spring, whenParts, whenPhrase } from '../lib';

interface PanelProps {
  state: StateResponse;
  onJump: (messageId: string) => void;
  onCancelFollowup: (id: string) => void;
  onToggleRoutine: (id: string, enabled: boolean) => void;
  onDeleteRoutine: (id: string) => void;
  /** Connected apps on this computer; null on the phone, where apps aren't managed. */
  appsCount?: number | null;
  onOpenApps?: () => void;
}

function headline(state: StateResponse): string {
  const n = state.messages.filter((m) => m.proposal?.status === 'pending').length;
  return n === 0 ? 'Nothing needs you right now.' : `${countWord(n)} ${n === 1 ? 'thing needs' : 'things need'} your approval.`;
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
  if (state.busy) return `Duet is ${state.busy}${state.busyDetail ? `: ${state.busyDetail}` : ''}.`;
  const next = upcomingOf(state).find((u) => u.routine?.enabled !== false);
  return next
    ? `Next up: ${next.followupId ? 'a follow-up' : next.routine ? 'a routine' : `the ${next.label.toLowerCase()}`} ${whenPhrase(next.at)}.`
    : 'Duet is idle.';
}

/** Duet speaks first: what needs you, what it is doing, what comes next. */
export function Panel({ state, onJump, onCancelFollowup, onToggleRoutine, onDeleteRoutine, appsCount, onOpenApps }: PanelProps) {
  const reduce = useReducedMotion();
  const pending = state.messages.filter((m) => m.proposal?.status === 'pending');
  const upcoming = upcomingOf(state);
  const title = headline(state);

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
            Its computer, {state.computer.name}: {state.computer.state === 'running' ? 'awake' : state.computer.state === 'suspended' || state.computer.state === 'stopped' ? 'asleep' : 'not checked yet'}.
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
            <h2>Needs you</h2>
            <ul className="needs">
              {pending.map((m) => (
                <li key={m.id}>
                  <button type="button" className="need" onClick={() => onJump(m.id)}>
                    <span className="need-text">{proposalHeadline(m.proposal!.actions)}</span>
                    <span className="need-time">
                      {channelName(state, m.channel)}Asked at {clock(m.ts)}
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
          <span className="nudge-title">Connect your apps</span>
          <span className="nudge-text">Let Duet watch your email, calendar and tasks, and come to you when something needs you.</span>
        </button>
      )}

      <section className="panel-section">
        <h2>Coming up</h2>
        <ul className="upcoming">
          {upcoming.map((u) => {
            const { day, time } = whenParts(u.at);
            const r = u.routine;
            return (
              <li key={u.key} className={r && !r.enabled ? 'routine-off' : undefined}>
                <span className="upcoming-when">
                  {day && <span className="upcoming-day">{day}</span>}
                  {time}
                </span>
                <span className="upcoming-what" title={u.label}>
                  {u.followupId ? `Follow-up: ${u.label}` : r ? `${r.enabled ? 'Routine' : 'Suggested, off'}: ${u.label}` : u.label}
                </span>
                {r && (
                  <span className="routine-controls">
                    <label className="check check-inline" title={isPhone && !r.enabled ? 'Turn routines on from your computer' : undefined}>
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={isPhone && !r.enabled}
                        onChange={(e) => onToggleRoutine(r.id, e.target.checked)}
                      />
                      <span>On</span>
                    </label>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      onClick={() => onDeleteRoutine(r.id)}
                      aria-label={`Delete routine: ${u.label}`}
                      title="Delete routine"
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
                    aria-label={`Cancel follow-up: ${u.label}`}
                    title="Cancel follow-up"
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
            {countWord(state.digestCount)} {state.digestCount === 1 ? 'thing' : 'things'} that can wait, saved for your next brief.
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
    <button type="button" className={`strip ${pending ? 'has-pending' : ''}`} onClick={onOpen} aria-label="Status and what's coming up">
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
