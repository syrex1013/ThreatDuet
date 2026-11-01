import { useEffect, useRef, useState } from 'react';
import type { Language, StateResponse } from '../../../src/shared/types';
import { post } from '../api';
import { t, tn } from '../i18n';

interface SetupProps {
  state: StateResponse;
  language: Language;
  onLanguage: (l: Language) => void;
  /** Connected apps on this computer, or null while unknown. */
  appsCount: number | null;
  onOpen: (kind: 'apps' | 'mac' | 'computer') => void;
  onDone: () => void;
}

const STEPS = 5;

/** First launch on the computer: who you are, your day, what to connect. Then Duet introduces itself. */
export function Setup({ state, language, onLanguage, appsCount, onOpen, onDone }: SetupProps) {
  const s = state.settings;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: '',
    about: '',
    // null until edited: the default reads in the language picked on step 1.
    focus: null as string | null,
    briefAt: s.briefAt,
    reportAt: s.reportAt,
    checkEveryHours: String(s.checkEveryHours),
    quietStart: s.quietStart,
    quietEnd: s.quietEnd,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  const focus = form.focus ?? t(s.focus);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const device = /Mac/i.test(navigator.platform) ? 'Mac' : 'PC';

  // Move focus to the new step's title, so keyboard and screen reader users land on it.
  useEffect(() => {
    if (first.current) first.current = false;
    else heading.current?.focus();
  }, [step]);

  const finish = async (skip: boolean) => {
    setBusy(true);
    setError(null);
    const f = form;
    // Empty fields keep the current settings.
    const body = skip
      ? { skip: true, language }
      : {
          skip: false,
          language,
          name: f.name.trim() || undefined,
          about: f.about.trim() || undefined,
          focus,
          briefAt: f.briefAt || undefined,
          reportAt: f.reportAt || undefined,
          checkEveryHours: f.checkEveryHours === '' ? undefined : Number(f.checkEveryHours),
          quietStart: f.quietStart || undefined,
          quietEnd: f.quietEnd || undefined,
        };
    try {
      await post('/setup', body);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const titles = [t('Welcome to OpenDuet'), t('About you'), t('Your day'), t('Connect your things'), t("You're ready")];

  return (
    <main className="setup">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step < STEPS - 1) setStep(step + 1);
          else void finish(false);
        }}
      >
        <ol className="setup-steps" aria-label={t('Step {n} of {total}', { n: step + 1, total: STEPS })}>
          {titles.map((title, i) => (
            <li key={i} className={i <= step ? 'is-done' : undefined} aria-current={i === step ? 'step' : undefined}>
              <span className="sr-only">{title}</span>
            </li>
          ))}
        </ol>
        <p className="setup-count" aria-hidden="true">
          {t('Step {n} of {total}', { n: step + 1, total: STEPS })}
        </p>
        <h1 className="setup-title" ref={heading} tabIndex={-1}>
          {titles[step]}
        </h1>

        {step === 0 && (
          <>
            <p className="setup-text">{t('Duet works next to you: it watches what matters, briefs you in the morning, and asks before it does anything that affects others.')}</p>
            <fieldset className="setup-langs">
              <legend className="field-label">{t('Language')}</legend>
              {(['en', 'pl'] as const).map((l) => (
                <label key={l} className="setup-lang" lang={l}>
                  <input type="radio" name="language" value={l} checked={language === l} onChange={() => onLanguage(l)} />
                  {l === 'en' ? 'English' : 'Polski'}
                </label>
              ))}
            </fieldset>
            <p className="hint">{t('For this app. Duet will also write to you in this language.')}</p>
          </>
        )}

        {step === 1 && (
          <>
            <div className="field">
              <label htmlFor="setup-name">{t('Your name (optional)')}</label>
              <input id="setup-name" autoComplete="given-name" value={form.name} onChange={set('name')} />
            </div>
            <div className="field">
              <label htmlFor="setup-about">{t('What do you do, and what are you working on?')}</label>
              <textarea id="setup-about" rows={4} value={form.about} onChange={set('about')} />
            </div>
            <div className="field">
              <label htmlFor="setup-focus">{t('What should Duet watch for?')}</label>
              <textarea id="setup-focus" rows={3} value={focus} onChange={set('focus')} aria-describedby="setup-focus-hint" />
              <p className="hint" id="setup-focus-hint">
                {t('Anything else it notices waits for your morning brief.')}
              </p>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="field-grid">
              <Field id="setup-briefAt" label={t('Morning brief')} type="time" value={form.briefAt} onChange={set('briefAt')} />
              <Field id="setup-reportAt" label={t('Evening report')} type="time" value={form.reportAt} onChange={set('reportAt')} />
              <Field id="setup-check" label={t('Check in every (hours)')} hint={t('0 turns check-ins off.')} type="number" min="0" max="168" step="0.5" value={form.checkEveryHours} onChange={set('checkEveryHours')} />
              <div />
              <Field id="setup-quietStart" label={t('Quiet from')} type="time" value={form.quietStart} onChange={set('quietStart')} />
              <Field id="setup-quietEnd" label={t('Quiet until')} type="time" value={form.quietEnd} onChange={set('quietEnd')} />
            </div>
            <p className="hint">{t("During quiet hours Duet doesn't check in or send notifications.")}</p>
          </>
        )}

        {step === 3 && (
          <>
            <p className="setup-text">{t('Duet is more useful when it can see your email, calendar and files. All of this is optional, and you can connect things later from the top bar.')}</p>
            <div className="setup-connect">
              <button type="button" className="btn btn-quiet" onClick={() => onOpen('apps')}>
                {t('Apps')}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => onOpen('mac')}>
                {t('Your {device}', { device })}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => onOpen('computer')}>
                {t("Duet's computer")}
              </button>
            </div>
            {appsCount !== null && <p className="hint">{tn(appsCount, 'Connected: {n} app', 'Connected: {n} apps')}</p>}
          </>
        )}

        {step === 4 && (
          <>
            <p className="setup-text">{t("Duet will introduce itself in the thread and suggest its first tasks. You'll find them in the side panel.")}</p>
            <dl className="setup-summary">
              {form.name.trim() && (
                <>
                  <dt>{t('Your name')}</dt>
                  <dd>{form.name.trim()}</dd>
                </>
              )}
              <dt>{t('Morning brief')}</dt>
              <dd>{form.briefAt}</dd>
              <dt>{t('Evening report')}</dt>
              <dd>{form.reportAt}</dd>
              <dt>{t('Check-in')}</dt>
              <dd>{Number(form.checkEveryHours) > 0 ? t('every {n} h', { n: form.checkEveryHours }) : t('off')}</dd>
              <dt>{t('Quiet hours')}</dt>
              <dd>
                {form.quietStart}–{form.quietEnd}
              </dd>
              {appsCount !== null && (
                <>
                  <dt>{t('Apps')}</dt>
                  <dd>{appsCount}</dd>
                </>
              )}
            </dl>
          </>
        )}

        {error && (
          <p className="is-error setup-error" role="alert">
            {error}
          </p>
        )}

        <div className="setup-nav">
          {step === 0 ? (
            <button type="button" className="btn btn-text" onClick={() => void finish(true)} disabled={busy}>
              {t('Skip setup')}
            </button>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setStep(step - 1)} disabled={busy}>
              {t('Back')}
            </button>
          )}
          <button type="submit" className="btn btn-send" disabled={busy}>
            {step < STEPS - 1 ? t('Next') : t('Start working with Duet')}
          </button>
        </div>
      </form>
    </main>
  );
}

function Field({ id, label, hint, ...input }: { id: string; label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}
