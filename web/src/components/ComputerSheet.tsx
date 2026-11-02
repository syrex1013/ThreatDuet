import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import type { ComputerStatus } from '../../../src/shared/types';
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
  const [administrator, setAdministrator] = useState(false);
  const enroll = useMutation({
    mutationFn: (values: Record<string, string>) => post(administrator ? '/computer/attach' : '/computer/enroll', values),
    onSuccess: onDone,
    onError: (e) => setError(e.message),
  });
  return (
    <form className="computer-connect" onSubmit={(event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
      enroll.mutate(values);
      (event.currentTarget.elements.namedItem(administrator ? 'token' : 'code') as HTMLInputElement).value = '';
    }}>
      <p>{t('Connect your private cloud workspace using an invite from your administrator.')}</p>
      <label>{t('Broker URL')}<input type="url" name="url" placeholder="https://work.example.com" required autoComplete="url" /></label>
      {!administrator && <label>{t('Your name')}<input name="name" maxLength={80} required autoComplete="name" /></label>}
      <label>{t(administrator ? 'Administrator installation token' : 'Private invite code')}<input type="password" name={administrator ? 'token' : 'code'} required autoComplete="off" /></label>
      <label className="check"><input type="checkbox" checked={administrator} onChange={(event) => setAdministrator(event.target.checked)} />{t('Attach administrator workspace')}</label>
      {error && <p className="is-error" role="alert">{error}</p>}
      <button className="btn btn-send" type="submit" disabled={enroll.isPending}>{t(enroll.isPending ? 'Connecting…' : 'Connect private workspace')}</button>
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
      {s.execution === 'queued' && <p role="status">{t('Cloud execution queued')} · {s.queuePosition}</p>}
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
  const [origin, setOrigin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: async () => {
      const r = (await post('/computer/session', { origin })) as { message?: string };
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
      <label>{t('Website origin for cookie transfer')}<input type="url" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://example.com" /></label>
      <p className="hint">{t('Copies cookies only. Some sites require a fresh login or additional browser storage.')}</p>
      <button type="button" className="btn btn-quiet btn-sm" disabled={act.isPending || !origin} onClick={() => act.mutate()}>
        {act.isPending ? t('Copying…') : t("Copy sign-ins to Duet's computer")}
      </button>
      <p className="hint">{t('Copies cookies for this website only. Browser storage, passkeys and device keys are not transferred.')}</p>
      {msg && <p className="hint">{msg}</p>}
      {err && (
        <p className="is-error" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
