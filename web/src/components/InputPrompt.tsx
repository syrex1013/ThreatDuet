import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PendingInput } from '../../../src/shared/types';
import { post } from '../api';
import { t } from '../i18n';
import { LiveBrowser } from './LiveBrowser';

/** Secure prompt for passwords / OTP / short text. Shows the live browser so you can see and drive any site. */
export function InputPrompt({ req, taskTitle, onDone }: { req: PendingInput; taskTitle?: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, [req.id]);

  const secret = req.kind === 'password' || req.kind === 'otp';
  const label = req.kind === 'password' ? t('Password') : req.kind === 'otp' ? t('One-time code') : req.kind === 'email' ? t('Email address') : req.kind === 'username' ? t('Username') : t('Your answer');
  const onComputer = req.target === 'computer';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const submitted = new FormData(e.currentTarget as HTMLFormElement).get('credential');
    if (typeof submitted !== 'string' || !submitted || busy) return;
    setBusy(true);
    setError(null);
    try {
      await post('/input', { id: req.id, value: submitted });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await post('/input/cancel', { id: req.id });
    } catch {
      /* already gone */
    }
    onDone();
  }

  return (
    <section className="input-prompt-card" aria-label={t('Duet needs your input')}>
      <h3>{t('Duet needs your input')}</h3>
      {taskTitle && <p>{taskTitle}</p>}
      <p className="hint">{onComputer ? t('Google and some sites block sign-in from automated cloud browsers. Sign in with your regular browser on this computer, then ask Duet to continue from your local browser. This app does not bypass site security checks.') : t('If a site still blocks sign-in, sign in with your regular browser, then reload sign-ins in settings.')}</p>
      <p className="hint">{req.prompt}</p>
      {req.origin && <p className="watch-where">{req.origin}</p>}
      <p className="hint">
        {onComputer
          ? t("Live view of Duet's cloud browser. Click the page if you need to focus a field; your answer below is typed into it and never enters the chat.")
          : t("Live view of the browser on this computer. Click any site's fields, then enter your answer below — it never goes into the chat.")}
      </p>

      <div className="input-prompt-live">
        <LiveBrowser source={onComputer ? 'computer' : 'local'} wake compact hidePassword />
      </div>

      <form className="watch-type watch-password input-prompt-form" onSubmit={submit}>
        <label htmlFor={`duet-input-${req.id}`} className="sr-only">
          {label}
        </label>
        <input
          id={`duet-input-${req.id}`}
          ref={input}
          type={secret ? 'password' : req.kind === 'email' ? 'email' : 'text'}
          inputMode={req.kind === 'otp' ? 'numeric' : req.kind === 'email' ? 'email' : undefined}
          name="credential"
          autoComplete={req.kind === 'password' ? 'current-password' : req.kind === 'otp' ? 'one-time-code' : req.kind === 'email' ? 'email' : 'username'}
          placeholder={label}
          required
          disabled={busy}
        />
        <button type="submit" className="btn btn-send btn-sm" disabled={busy}>
          {busy ? t('Sending…') : t('Fill and continue')}
        </button>
        <button type="button" className="btn btn-text btn-sm" disabled={busy} onClick={() => void cancel()}>
          {t('Cancel')}
        </button>
      </form>
      {error && (
        <p className="is-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
