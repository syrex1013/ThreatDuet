import { AlertTriangle, Check, Clock, FileText } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import type { Message, Proposal } from '../../../src/shared/types';
import { t } from '../i18n';
import { clock, groupByDay, KIND_TITLE, spring, summarizeTools } from '../lib';
import { Mark } from './Mark';
import { Markdown } from './Markdown';

interface TimelineProps {
  messages: Message[];
  busy: string | null;
  busyDetail: string | null;
  briefAt: string;
  acting: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onOpenFile: (path: string) => void;
  onSuggest: (text: string) => void;
}

const SUGGESTIONS = [
  "Prepare me for tomorrow's client call: research the company and draft an agenda.",
  'Go through my workspace notes and list every open follow-up with its deadline.',
  'Check back with me on Monday at 09:00 about the Acme proposal.',
];

export function Timeline({ messages, busy, busyDetail, briefAt, acting, onApprove, onReject, onOpenFile, onSuggest }: TimelineProps) {
  const reduce = useReducedMotion();
  // Entries that arrive after the page opened animate in; the backlog appears at once.
  const openedAt = useRef(Date.now());

  if (!messages.length) {
    return (
      <section className="timeline empty" aria-label={t('Thread')}>
        <Mark size={28} className="empty-mark" />
        <h1 className="empty-title">{t('Hand Duet anything on your plate.')}</h1>
        <p className="empty-text">
          {t(
            'It works on it in the background, briefs you every morning at {briefAt}, checks in when something needs you, and asks before it sends, pays, signs or deletes anything.',
            { briefAt },
          )}
        </p>
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="suggestion" onClick={() => onSuggest(t(s))}>
              {t(s)}
            </button>
          ))}
        </div>
        <NowLine busy={busy} detail={busyDetail} />
      </section>
    );
  }

  return (
    <section className="timeline" aria-label={t('Thread')}>
      {groupByDay(messages).map((group) => (
        <div key={group.label} className="day">
          <h2 className="day-label">
            <span>{group.label}</span>
          </h2>
          <AnimatePresence initial={false}>
            {group.items.map((m) => (
              <motion.div
                key={m.id}
                layout="position"
                initial={m.ts >= openedAt.current ? { opacity: 0, y: 14 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={spring(reduce)}
              >
                <Entry m={m} acting={acting} onApprove={onApprove} onReject={onReject} onOpenFile={onOpenFile} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ))}
      <NowLine busy={busy} detail={busyDetail} />
    </section>
  );
}

type EntryProps = Pick<TimelineProps, 'acting' | 'onApprove' | 'onReject' | 'onOpenFile'> & { m: Message };

function Entry({ m, acting, onApprove, onReject, onOpenFile }: EntryProps) {
  if (m.role === 'system') {
    const Icon = m.kind === 'error' ? AlertTriangle : Clock;
    return (
      <div className={`entry entry-system ${m.kind === 'error' ? 'is-error' : ''}`} id={`m-${m.id}`}>
        <time dateTime={new Date(m.ts).toISOString()}>{clock(m.ts)}</time>
        <p>
          <Icon size={14} aria-hidden="true" />
          {m.text}
        </p>
      </div>
    );
  }

  const title = m.role === 'user' ? t('You') : t(KIND_TITLE[m.kind] ?? 'Duet');
  const { files, notes } = summarizeTools(m.tools);
  return (
    <article
      className={`entry entry-${m.role} kind-${m.kind} ${m.pending ? 'is-pending' : ''}`}
      id={`m-${m.id}`}
      aria-label={t('{title} at {time}', { title, time: clock(m.ts) })}
    >
      <time dateTime={new Date(m.ts).toISOString()}>{m.pending ? t('Sending') : clock(m.ts)}</time>
      <div className="entry-body">
        <h3 className="entry-title">
          {m.role === 'duet' && <Mark size={14} className="entry-mark" />}
          {title}
        </h3>
        {m.role === 'user' ? <p className="user-text">{m.text}</p> : m.text && <Markdown text={m.text} />}
        {(files.length > 0 || notes.length > 0) && (
          <div className="work">
            {files.map((f) => (
              <button key={f} type="button" className="file-chip" onClick={() => onOpenFile(f)} title={t('Open {file}', { file: f })}>
                <FileText size={14} aria-hidden="true" />
                {f}
              </button>
            ))}
            {notes.length > 0 && <span className="work-notes">{notes.join(', ')}.</span>}
          </div>
        )}
        {m.proposal && (
          <ProposalBlock p={m.proposal} busy={acting === m.id} onApprove={() => onApprove(m.id)} onReject={() => onReject(m.id)} />
        )}
      </div>
    </article>
  );
}

const RESOLVED: Record<Exclude<Proposal['status'], 'pending'>, string> = {
  approved: 'Approved. Duet is doing it now.',
  done: 'Approved and done.',
  failed: "Approved, but it didn't finish. The error is below.",
  rejected: 'You rejected this.',
  blocked: "Duet can't do this, even with your approval.",
  interrupted: 'Approved, but a restart stopped it partway. Check the workspace, then ask Duet to try again.',
};

function ProposalBlock({ p, busy, onApprove, onReject }: { p: Proposal; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      {p.status === 'pending' ? (
        <motion.div
          key="pending"
          className="proposal pending reticle"
          role="group"
          aria-label={t('Waiting for your approval')}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={spring(reduce)}
        >
          <div className="proposal-card">
            <p className="proposal-title">{t('Waiting for your approval')}</p>
            <Markdown text={p.actions} />
            {p.flags?.length ? (
              <p className="proposal-flag">{t('Contains health/financial information. Approving shares it with the recipients.')}</p>
            ) : null}
            <div className="proposal-actions">
              <button type="button" className="btn btn-approve" onClick={onApprove} disabled={busy}>
                {busy ? t('Approving…') : t('Approve')}
              </button>
              <button type="button" className="btn btn-quiet" onClick={onReject} disabled={busy}>
                {t('Reject')}
              </button>
              <span className="proposal-hint">{t('Nothing leaves your workspace until you approve.')}</span>
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="resolved"
          className={`proposal resolved status-${p.status} ${['blocked', 'failed', 'interrupted'].includes(p.status) ? 'is-bad' : ''}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={spring(reduce)}
        >
          <Markdown text={p.actions} />
          <p className="proposal-status">
            {p.status === 'done' && <Check size={15} aria-hidden="true" />}
            {p.status === 'approved' && <span className="pulse" aria-hidden="true" />}
            {p.status === 'blocked' && p.reason ? `${t('Blocked: {reason}.', { reason: p.reason })} ` : ''}
            {t(RESOLVED[p.status])}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function NowLine({ busy, detail }: { busy: string | null; detail: string | null }) {
  const reduce = useReducedMotion();
  return (
    <div className="now" aria-live="polite">
      <span className="now-label">{t('Now')}</span>
      <span className="now-rule" aria-hidden="true" />
      <AnimatePresence initial={false}>
        {busy && (
          <motion.span
            className="now-busy"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring(reduce)}
          >
            <span className="pulse" aria-hidden="true" />
            <span>
              {t('Duet is {busy}', { busy: t(busy) })}
              {detail && <span className="now-detail"> · {detail}</span>}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
