import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { ComputerChoice, ComputerStatus } from '../../../src/shared/types';
import { getComputer, post } from '../api';
import { t } from '../i18n';
import { LiveBrowser } from './LiveBrowser';
import { Sheet } from './Sheet';

/** Duet's cloud computer: connect an Instabox machine, watch its browser, and take over when needed. */
export function ComputerSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['computer'],
    queryFn: getComputer,
    refetchInterval: (q) => (q.state.data?.setup?.running ? 1500 : 10_000),
  });
  const s = status.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['computer'] });

  return (
    <Sheet title={t("Duet's computer")} wide onClose={onClose}>
      {!s ? (
        <p className="muted">{status.error?.message ?? t('Checking…')}</p>
      ) : !s.connected ? (
        <Connect onDone={refresh} />
      ) : (
        <Connected s={s} onChange={refresh} />
      )}
    </Sheet>
  );
}

function Connect({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<ComputerChoice[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const find = useMutation({
    mutationFn: () => post<{ machines: ComputerChoice[] }>('/computer/machines', {}),
    onSuccess: (r) => {
      setError(null);
      setChoices(r.machines);
      setPicked(r.machines.find((m) => m.hasBrowser)?.id ?? r.machines[0]?.id ?? null);
    },
    onError: (e) => setError(e.message),
  });
  const connect = useMutation({
    mutationFn: () => post('/computer/connect', { machineId: picked }),
    onSuccess: onDone,
    onError: (e) => setError(e.message),
  });
  const chosen = choices?.find((m) => m.id === picked);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!choices) find.mutate();
    else if (picked) connect.mutate();
  };

  return (
    <form onSubmit={submit} className="computer-connect">
      <p className="apps-intro">
        {t(
          'Give Duet its own computer in the cloud, with a browser. It can look things up and work there while your laptop and phone are off. Duet reads pages on its own; clicking, typing and running commands wait for your approval.',
        )}
      </p>
      {choices && (
        <fieldset className="machines">
          <legend>{t('Which machine should Duet use?')}</legend>
          {choices.map((m) => (
            <label key={m.id} className="radio machine">
              <input type="radio" name="machine" checked={picked === m.id} onChange={() => setPicked(m.id)} />
              <span>
                <strong>{m.name}</strong> <span className="muted">{m.hasBrowser ? m.state : t('{state}, no browser', { state: m.state })}</span>
              </span>
            </label>
          ))}
          {choices.length === 0 && <p className="hint">{t('There are no machines on this account yet. Create one with the agent-browser template, then come back.')}</p>}
          {chosen && !chosen.hasBrowser && <p className="warning">{t('This machine has no desktop browser. Duet needs one made from the agent-browser template.')}</p>}
          {chosen?.vault && (
            <p className="warning">
              <AlertTriangle size={14} aria-hidden="true" />{' '}
              {t(
                'This machine can read your Instabox Vault secrets. Anything Duet opens or runs there could reach them. Turn Vault off for this machine in the Instabox dashboard before connecting, or pick a machine that has it off.',
              )}
            </p>
          )}
          <p className="hint">{t('Duet works in its own folder on the machine and never deletes the machine.')}</p>
        </fieldset>
      )}

      {error && (
        <p className="is-error apps-error" role="alert">
          {error}
        </p>
      )}
      <div className="reset">
        <button type="submit" className="btn btn-send" disabled={find.isPending || connect.isPending || (Boolean(choices) && !picked)}>
          {!choices ? (find.isPending ? t('Looking…') : t('Find my machines')) : connect.isPending ? t('Connecting…') : t('Connect this machine')}
        </button>
      </div>
    </form>
  );
}

const STATE_TEXT: Record<string, string> = { running: 'Awake', suspended: 'Asleep, wakes when Duet needs it', stopped: 'Switched off, starts when Duet needs it', unknown: "Can't reach it right now" };

function Connected({ s, onChange }: { s: ComputerStatus; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const act = useMutation({ mutationFn: (path: string) => post(path), onSettled: onChange });
  const setAuto = useMutation({ mutationFn: (auto: boolean) => post('/computer/auto', { auto }), onSettled: onChange });
  const setup = s.setup;
  const ready = !setup;

  return (
    <div className="computer">
      <div className="computer-head">
        <span className="app-badge" aria-hidden="true">
          {(s.name ?? 'C').slice(0, 1).toUpperCase()}
        </span>
        <div className="app-main">
          <div className="app-name">{s.name}</div>
          <div className="app-state">{setup?.running ? `${t(setup.step)}…` : setup?.error ? t('Setup needs attention') : t(STATE_TEXT[s.machineState ?? 'unknown'] ?? s.machineState ?? '')}</div>
        </div>
      </div>

      {setup?.running && (
        <p className="signin" role="status">
          <span className="pulse" aria-hidden="true" />
          <span className="signin-text">
            <strong>{t(setup.step)}…</strong>
            <span className="hint">{t('The first setup takes a minute or two.')}</span>
          </span>
        </p>
      )}
      {setup?.error && (
        <div className="apps-error" role="alert">
          <p className="is-error">
            {t('{step} failed.', { step: t(setup.step) })} {setup.error}
          </p>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => act.mutate('/computer/retry')}>
            {t('Try again')}
          </button>
        </div>
      )}
      {s.error && <p className="is-error apps-error">{s.error}</p>}
      {s.vault && (
        <p className="warning">
          <AlertTriangle size={14} aria-hidden="true" /> {t('This machine can read your Instabox Vault secrets. Turn Vault off for it in the Instabox dashboard.')}
        </p>
      )}

      {ready && <SessionPush />}
      {ready && <LiveBrowser wake={false} />}

      <section className="apps-section" aria-label={t('Auto mode')}>
        <h3>{t('Auto mode')}</h3>
        <label className="check">
          <input type="checkbox" checked={s.auto} disabled={setAuto.isPending} onChange={(e) => setAuto.mutate(e.target.checked)} />
          <span>
            {t('Let Duet use its cloud computer without asking (allow all)')}
            <span className="hint">{t('Opening pages, clicking, typing, running commands and writing files on the cloud computer run on their own. No proposal, no approval. Your own computer keeps its own setting. Text in a page or file could steer Duet there, and it can open any page even with web pages off, so anything signed in on that machine is exposed.')}</span>
          </span>
        </label>
      </section>

      <div className="reset">
        {confirming ? (
          <span className="confirm">
            {t('Disconnect Duet from {name}? The machine stays as it is.', { name: s.name ?? '' })}
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => act.mutate('/computer/disconnect')}>
              {t('Disconnect')}
            </button>
            <button type="button" className="btn btn-text btn-sm" onClick={() => setConfirming(false)}>
              {t('Keep')}
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-text btn-sm" onClick={() => setConfirming(true)}>
            {t('Disconnect…')}
          </button>
        )}
      </div>
    </div>
  );
}


function SessionPush() {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: async () => {
      const r = (await post('/computer/session', {})) as { message?: string };
      return r;
    },
    onSuccess: (r) => {
      setErr(null);
      setMsg((r && r.message) || t('Sign-ins copied to the cloud browser.'));
    },
    onError: (e: Error) => {
      setMsg(null);
      setErr(e.message);
    },
  });
  return (
    <div className="session-push">
      <button type="button" className="btn btn-quiet btn-sm" disabled={act.isPending} onClick={() => act.mutate()}>
        {act.isPending ? t('Copying…') : t("Copy sign-ins to Duet's computer")}
      </button>
      <p className="hint">{t('Moves the ThreatDuet browser session from this Mac/PC into the cloud browser so Duet stays signed in there.')}</p>
      {msg && <p className="hint">{msg}</p>}
      {err && (
        <p className="is-error" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
