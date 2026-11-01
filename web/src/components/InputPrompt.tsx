import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PendingInput } from '../../../src/shared/types';
import { post } from '../api';
import { t } from '../i18n';
import { LiveBrowser } from './LiveBrowser';
import { Sheet } from './Sheet';

/** Secure prompt for passwords / OTP / short text. Shows the live browser so you can see and drive any site. */
export function InputPrompt({ req, onDone }: { req: PendingInput; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, [req.id]);

  const secret = req.kind === 'password' || req.kind === 'otp';
  const label =
    req.kind === 'password' ? t('Password') : req.kind === 'otp' ? t('One-time code') : t('Your answer');
  const onComputer = req.target === 'computer';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await post('/input', { id: req.id, value });
      setValue('');
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
    <Sheet title={t('Duet needs your input')} wide onClose={() => void cancel()}>
      <p className="hint">{req.prompt}</p>
      {req.url && <p className="watch-where">{req.url}</p>}
      <p className="hint">
        {onComputer
          ? t("Live view of Duet's cloud browser. Click the page if you need to focus a field; your answer below is typed into it and never enters the chat.")
          : t("Live view of the browser on this computer (Mac, Windows or Linux). Click any site's fields, then enter your answer below — it never goes into the chat.")}
      </p>

      <div className="input-prompt-live">
        <LiveBrowser source={onComputer ? 'computer' : 'local'} wake compact hidePassword />
      </div>

      <form className="watch-type watch-password input-prompt-form" onSubmit={submit}>
        <label htmlFor="duet-input" className="sr-only">
          {label}
        </label>
        <input
          id="duet-input"
          ref={input}
          type={secret ? 'password' : 'text'}
          inputMode={req.kind === 'otp' ? 'numeric' : undefined}
          autoComplete={req.kind === 'password' ? 'current-password' : 'off'}
          value={value}
          placeholder={label}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn btn-send btn-sm" disabled={!value || busy}>
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
    </Sheet>
  );
}
