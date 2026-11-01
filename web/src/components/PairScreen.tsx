import { useState, type FormEvent } from 'react';
import { normalizeUrl, type Connection } from '../connection';
import { t } from '../i18n';

interface PairScreenProps {
  error: string | null;
  busy: boolean;
  onPair: (c: Connection) => void;
}

/** First run on the phone: pair with ThreatDuet on the computer, by QR code or by hand. */
export function PairScreen({ error, busy, onPair }: PairScreenProps) {
  const [address, setAddress] = useState('');
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = normalizeUrl(address);
    if (!url) return setFormError(t('Enter the address shown on your computer, like 100.64.0.10:4320.'));
    if (!code.trim()) return setFormError(t('Enter the pairing code shown on your computer.'));
    setFormError(null);
    onPair({ url, token: code.trim() });
  };

  return (
    <main className="pair">
      <h1 className="pair-title">{t('Pair with your computer.')}</h1>
      <p className="pair-text">
        {t('Duet works on your computer. This app shows you its briefs, asks you for approvals and lets you hand it tasks from anywhere.')}
      </p>
      <ol className="pair-steps">
        <li>{t('On your computer, open ThreatDuet, then Settings, then Phone.')}</li>
        <li>{t('Turn on phone access.')}</li>
        <li>{t("Scan the code with your phone's camera.")}</li>
      </ol>

      <form className="pair-form" onSubmit={submit}>
        <h2>{t('Or enter it by hand')}</h2>
        <div className="field">
          <label htmlFor="pair-address">{t('Computer address')}</label>
          <input
            id="pair-address"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="100.64.0.10:4320"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pair-code">{t('Pairing code')}</label>
          <input
            id="pair-code"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-send" disabled={busy}>
          {busy ? t('Pairing…') : t('Pair phone')}
        </button>
        {(formError ?? error) && (
          <p className="is-error pair-error" role="alert">
            {formError ?? error}
          </p>
        )}
      </form>
    </main>
  );
}
