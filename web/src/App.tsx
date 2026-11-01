import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Blocks, FolderOpen, Laptop, Maximize2, Minimize2, Monitor, RefreshCw, Settings } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { Message, StateResponse } from '../../src/shared/types';
import { getConnectors, post } from './api';
import { AppsSheet } from './components/AppsSheet';
import { ComputerSheet } from './components/ComputerSheet';
import { MacSheet } from './components/MacSheet';
import { Channels } from './components/Channels';
import { Composer } from './components/Composer';
import { FileViewer } from './components/FileViewer';
import { Make } from './components/Make';
import { PairScreen } from './components/PairScreen';
import { Panel, StatusStrip } from './components/Panel';
import { SettingsSheet } from './components/SettingsSheet';
import { Sheet } from './components/Sheet';
import { Timeline } from './components/Timeline';
import { connection, isPhone, saveConnection, type Connection } from './connection';
import { prefersReducedMotion, spring, useMedia } from './lib';
import { clearCachedState, useLiveState, type ConnectionStatus } from './live';
import { appIsActive, askForNotifications, configureBackground, markSeen, onPairLink, verifyConnection } from './phone';

export function App() {
  const qc = useQueryClient();
  const [paired, setPaired] = useState(() => !isPhone || connection() !== null);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);

  const pair = async (c: Connection) => {
    setPairing(true);
    setPairError(null);
    try {
      const state = await verifyConnection(c);
      await saveConnection(c);
      // Start background checks from now, so the phone doesn't announce old messages.
      await configureBackground(c, Math.max(0, ...state.messages.map((m) => m.ts)));
      await askForNotifications().catch(() => {});
      qc.clear();
      setPaired(true);
    } catch (e) {
      setPairError((e as Error).message);
    } finally {
      setPairing(false);
    }
  };

  const unpair = async () => {
    await saveConnection(null);
    await configureBackground(null);
    clearCachedState();
    qc.clear();
    setPaired(false);
  };

  useEffect(() => (isPhone ? onPairLink((c) => void pair(c)) : undefined), []);

  if (!paired)
    return (
      <>
        <Topbar />
        <PairScreen busy={pairing} error={pairError} onPair={(c) => void pair(c)} />
      </>
    );
  return <Workspace onUnpair={unpair} />;
}

function Topbar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <a className="wordmark" href="/" aria-label="OpenDuet home" onClick={(e) => isPhone && e.preventDefault()}>
        <span>Open</span>
        <span className="wordmark-block">Duet</span>
      </a>
      {children}
    </header>
  );
}

/** The desktop app's small floating window; `data-compact` lets CSS trim the top bar. */
function useCompact() {
  const [compact, setCompact] = useState(false);
  useEffect(
    () =>
      window.openduet?.onCompact((c) => {
        setCompact(c);
        if (c) document.documentElement.dataset.compact = '';
        else delete document.documentElement.dataset.compact;
      }),
    [],
  );
  return compact;
}

type Sheet = { kind: 'settings' } | { kind: 'file'; path: string } | { kind: 'panel' } | { kind: 'apps' } | { kind: 'computer' } | { kind: 'mac' } | { kind: 'make' };

function Workspace({ onUnpair }: { onUnpair: () => void }) {
  const qc = useQueryClient();
  const { state: data, status, error: loadError, fromCache } = useLiveState();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const compact = useCompact();
  const [channelPick, setChannel] = useState<string | undefined>();
  const channels = data?.channels ?? [];
  // A channel closed elsewhere (another window, the phone) falls back to Main.
  const channel = channels.some((c) => c.id === channelPick) ? channelPick : undefined;
  const shown = data?.messages.filter((m) => m.channel === channel);
  const narrow = useMedia('(max-width: 959px)');
  // Apps are managed on the computer; the phone doesn't ask (and the phone listener doesn't serve them).
  const apps = useQuery({ queryKey: ['connectors'], queryFn: () => getConnectors(), enabled: !isPhone, staleTime: 60_000 });
  const appsCount = isPhone ? null : (apps.data?.connectors.length ?? null);

  const act = useMutation({
    mutationFn: ([path, body]: [string, unknown?]) => post(path, body),
    onSuccess: () => setError(null),
    onError: (e) => setError(e.message),
    onSettled: () => {
      setActing(null);
      void qc.invalidateQueries({ queryKey: ['state'] });
    },
  });
  const run = (path: string, body?: unknown) => act.mutate([path, body]);

  // The message shows up at once; the server's copy replaces it on the next refresh.
  const send = useMutation({
    mutationFn: (text: string) => post('/message', { text, channel }),
    onMutate: async (text) => {
      await qc.cancelQueries({ queryKey: ['state'] });
      const before = qc.getQueryData<StateResponse>(['state']);
      if (before) {
        const optimistic: Message = { id: `pending-${Date.now()}`, ts: Date.now(), role: 'user', kind: 'chat', text, channel, pending: true };
        qc.setQueryData<StateResponse>(['state'], { ...before, messages: [...before.messages, optimistic] });
      }
      return { before, text };
    },
    onError: (e, _text, ctx) => {
      if (ctx?.before) qc.setQueryData(['state'], ctx.before);
      setDraft(ctx?.text ?? '');
      setError(`Couldn't send that. ${e.message}`);
    },
    onSuccess: () => setError(null),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  const decide = (path: '/approve' | '/reject', id: string) => {
    setActing(id);
    const before = qc.getQueryData<StateResponse>(['state']);
    if (before)
      qc.setQueryData<StateResponse>(['state'], {
        ...before,
        messages: before.messages.map((m) =>
          m.id === id && m.proposal ? { ...m, proposal: { ...m.proposal, status: path === '/approve' ? 'approved' : 'rejected' } } : m,
        ),
      });
    act.mutate([path, { id }], { onError: () => before && qc.setQueryData(['state'], before) });
  };

  useStickToBottom(shown?.length, data?.busy);
  useMarkSeen(data?.messages);

  const jumpTo = (id: string) => {
    setSheet(null);
    setChannel(data?.messages.find((m) => m.id === id)?.channel);
    // After the switched channel has rendered.
    setTimeout(() => {
      const el = document.getElementById(`m-${id}`);
      el?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
      el?.querySelector<HTMLButtonElement>('.btn-approve')?.focus({ preventScroll: true });
    });
  };

  const panel = data && (
    <Panel
      state={data}
      onJump={jumpTo}
      onCancelFollowup={(id) => run('/followups/cancel', { id })}
      onToggleRoutine={(id, enabled) => run('/routines/toggle', { id, enabled })}
      onDeleteRoutine={(id) => run('/routines/delete', { id })}
      appsCount={appsCount}
      onOpenApps={() => setSheet({ kind: 'apps' })}
    />
  );

  return (
    <>
      <Topbar>
        <nav className="topbar-actions" aria-label="Run now">
          <button type="button" className="btn btn-text" onClick={() => run('/run', { kind: 'brief' })}>
            Brief me
          </button>
          <button type="button" className="btn btn-text" onClick={() => run('/run', { kind: 'check' })}>
            Check in
          </button>
          <button type="button" className="btn btn-text" onClick={() => run('/run', { kind: 'report' })}>
            Write report
          </button>
          <button type="button" className="icon-btn" onClick={() => setSheet({ kind: 'make' })} aria-label="Made by Duet" title="Made by Duet">
            <FolderOpen size={20} aria-hidden="true" />
          </button>
          {!isPhone && (
            <>
              <button type="button" className="icon-btn" onClick={() => setSheet({ kind: 'computer' })} aria-label="Duet's computer" title="Duet's computer">
                <Monitor size={20} aria-hidden="true" />
              </button>
              <button type="button" className="icon-btn" onClick={() => setSheet({ kind: 'mac' })} aria-label={`Your ${/Mac/i.test(navigator.platform) ? 'Mac' : 'PC'}`} title={`Your ${/Mac/i.test(navigator.platform) ? 'Mac' : 'PC'}`}>
                <Laptop size={20} aria-hidden="true" />
              </button>
              <button type="button" className="icon-btn" onClick={() => setSheet({ kind: 'apps' })} aria-label="Apps" title="Apps">
                <Blocks size={20} aria-hidden="true" />
              </button>
            </>
          )}
          <button type="button" className="icon-btn" onClick={() => setSheet({ kind: 'settings' })} aria-label="Settings" title="Settings">
            <Settings size={20} aria-hidden="true" />
          </button>
          {window.openduet && (
            <button type="button" className="icon-btn" onClick={() => window.openduet?.toggleCompact()} aria-label={compact ? 'Full window' : 'Compact window'} title={`${compact ? 'Full window' : 'Compact window'} (${/Mac/i.test(navigator.platform) ? '⌘⇧M' : 'Ctrl+Shift+M'})`}>
              {compact ? <Maximize2 size={20} aria-hidden="true" /> : <Minimize2 size={20} aria-hidden="true" />}
            </button>
          )}
        </nav>
      </Topbar>

      <ConnectionBanner status={status} hasData={Boolean(data)} error={loadError} onRetry={() => qc.invalidateQueries({ queryKey: ['state'] })} onUnpair={onUnpair} />

      {!data ? (
        <main className="loading">
          {!loadError && (
            <>
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line short" />
            </>
          )}
        </main>
      ) : (
        <div className={`layout ${narrow ? 'is-narrow' : ''}`}>
          {narrow ? <StatusStrip state={data} onOpen={() => setSheet({ kind: 'panel' })} /> : <aside className="sidebar" aria-label="Status">{panel}</aside>}
          <main className="main">
            <Channels
              channels={channels}
              messages={data.messages}
              active={channel}
              onSelect={setChannel}
              onCreate={(name) =>
                post<{ id: string }>('/channels', { name }).then(
                  // Select it once the state that has it arrived; until then it would read as Main.
                  async (r) => {
                    await qc.invalidateQueries({ queryKey: ['state'] });
                    setChannel(r.id);
                  },
                  (e) => setError(e.message),
                )
              }
              onDelete={(id) => run('/channels/delete', { id })}
            />
            <Timeline
              messages={shown!}
              busy={data.busy}
              busyDetail={data.busyDetail}
              briefAt={data.settings.briefAt}
              acting={acting}
              onApprove={(id) => decide('/approve', id)}
              onReject={(id) => decide('/reject', id)}
              onOpenFile={(path) => setSheet({ kind: 'file', path })}
              onSuggest={setDraft}
            />
            <Composer text={draft} setText={setDraft} error={error} onSend={(text) => send.mutate(text)} />
          </main>
        </div>
      )}

      {sheet?.kind === 'settings' && data && (
        <SettingsSheet state={data} fromCache={fromCache} onClose={() => setSheet(null)} onSave={(path, body) => run(path, path === '/new-thread' ? { channel } : body)} onSaveSettings={(body) => act.mutateAsync(['/settings', body])} onUnpair={onUnpair} onOpenApps={() => setSheet({ kind: 'apps' })} />
      )}
      {sheet?.kind === 'file' && <FileViewer path={sheet.path} onClose={() => setSheet(null)} onAsk={(text) => send.mutate(text)} />}
      {sheet?.kind === 'make' && <Make onOpen={(path) => setSheet({ kind: 'file', path })} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'computer' && <ComputerSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === 'mac' && <MacSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === 'apps' && (
        <AppsSheet
          onClose={() => {
            setSheet(null);
            void qc.invalidateQueries({ queryKey: ['connectors'] });
          }}
        />
      )}
      {sheet?.kind === 'panel' && data && (
        <Sheet title="Status" onClose={() => setSheet(null)}>
          {panel}
        </Sheet>
      )}
    </>
  );
}

interface BannerProps {
  status: ConnectionStatus;
  hasData: boolean;
  error: Error | null;
  onRetry: () => void;
  onUnpair: () => void;
}

/** Quiet while connected; one line when the connection is in doubt, over whatever is already on screen. */
function ConnectionBanner({ status, hasData, error, onRetry, onUnpair }: BannerProps) {
  const reduce = useReducedMotion();
  const show = status === 'reconnecting';
  const text = isPhone
    ? hasData
      ? "Can't reach your computer right now. Showing what Duet last sent."
      : (error?.message ?? "Can't reach your computer.")
    : hasData
      ? 'Reconnecting to Duet…'
      : 'The OpenDuet server is not running. Start it with npm start, then retry.';
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          className="banner"
          role="status"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={spring(reduce)}
        >
          <span className="pulse" aria-hidden="true" />
          <span className="banner-text">{text}</span>
          <button type="button" className="btn btn-text" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
          {isPhone && (
            <button type="button" className="btn btn-text" onClick={onUnpair}>
              Pair again
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * On the phone, tell the background check what the user has actually looked at, so it only notifies about news.
 * A backgrounded WebView can still poll, so "on screen" means the app is active, not just the document visible.
 */
function useMarkSeen(messages: Message[] | undefined) {
  const last = useRef(0);
  useEffect(() => {
    if (!isPhone || !messages?.length || document.hidden) return;
    const latest = Math.max(...messages.filter((m) => m.role === 'duet').map((m) => m.ts), 0);
    if (latest <= last.current) return;
    void (async () => {
      if (!(await appIsActive())) return;
      last.current = latest;
      await markSeen(latest).catch(() => {});
    })();
  }, [messages]);
}

/**
 * Follow new entries unless the reader has scrolled up to read something older.
 * "At the bottom" is measured before the new entry renders, so a long reply can't push the reader off.
 */
function useStickToBottom(count: number | undefined, busy: string | null | undefined) {
  const first = useRef(true);
  const wasAtBottom = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      wasAtBottom.current = innerHeight + scrollY >= document.documentElement.scrollHeight - 160;
    };
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (count === undefined) return;
    if (first.current || wasAtBottom.current) {
      const behavior = first.current || prefersReducedMotion() ? 'auto' : 'smooth';
      // Twice: once now, once after Motion has laid the entry out.
      scrollTo({ top: document.documentElement.scrollHeight, behavior });
      const t = setTimeout(() => scrollTo({ top: document.documentElement.scrollHeight, behavior }), 350);
      first.current = false;
      return () => clearTimeout(t);
    }
    first.current = false;
  }, [count, busy]);
}
