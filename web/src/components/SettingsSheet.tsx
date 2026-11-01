import { useState } from 'react';
import type { Language, StateResponse } from '../../../src/shared/types';
import { connection, isPhone } from '../connection';
import { t } from '../i18n';
import { settingsPatch, type SettingsForm } from '../settingsPatch';
import { PhoneAccess } from './PhoneAccess';
import { Sheet } from './Sheet';

interface SettingsSheetProps {
  state: StateResponse;
  /** The phone's cached state has no memory, so it must not be edited from it. */
  fromCache?: boolean;
  onClose: () => void;
  onSave: (path: string, body?: unknown) => void;
  onSaveSettings: (body: Record<string, unknown>) => Promise<unknown>;
  onUnpair?: () => void;
  onOpenApps?: () => void;
}

export function SettingsSheet({ state, fromCache = false, onClose, onSave, onSaveSettings, onUnpair, onOpenApps }: SettingsSheetProps) {
  const [initial] = useState<SettingsForm>(() => {
    const { openWebPages: _openWebPages, ...settings } = state.settings;
    return { ...settings, checkEveryHours: String(settings.checkEveryHours), memory: state.memory ?? '' };
  });
  const [form, setForm] = useState(initial);
  const [memoryLocked] = useState(fromCache);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const save = async () => {
    setSaving(true);
    try {
      await onSaveSettings(settingsPatch(initial, form));
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <Sheet
      title={t('Settings')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn-send" onClick={() => void save()} disabled={saving}>
            {t('Save settings')}
          </button>
        </>
      }
    >
      {error && (
        <p className="is-error" role="alert">
          {error}
        </p>
      )}
      <fieldset>
        <div className="field">
          <label htmlFor="language">{t('Language')}</label>
          <select id="language" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Language })} aria-describedby="language-hint">
            <option value="en" lang="en">
              English
            </option>
            <option value="pl" lang="pl">
              Polski
            </option>
          </select>
          <p className="hint" id="language-hint">
            {t('For this app. Duet will also write to you in this language.')}
          </p>
        </div>
      </fieldset>

      <fieldset>
        <legend>{t('Schedule')}</legend>
        <div className="field-grid">
          <Field id="briefAt" label={t('Morning brief')} type="time" value={form.briefAt} onChange={set('briefAt')} />
          <Field id="reportAt" label={t('Evening report')} type="time" value={form.reportAt} onChange={set('reportAt')} />
          <Field
            id="checkEveryHours"
            label={t('Check in every (hours)')}
            hint={t('0 turns check-ins off.')}
            type="number"
            min="0"
            step="0.5"
            value={form.checkEveryHours}
            onChange={set('checkEveryHours')}
          />
          <div />
          <Field id="quietStart" label={t('Quiet from')} type="time" value={form.quietStart} onChange={set('quietStart')} />
          <Field id="quietEnd" label={t('Quiet until')} type="time" value={form.quietEnd} onChange={set('quietEnd')} />
        </div>
        <p className="hint">{t("During quiet hours Duet doesn't check in or send notifications.")}</p>
      </fieldset>

      <fieldset>
        <legend>{t('What Duet tells you about')}</legend>
        <label htmlFor="focus" className="sr-only">
          {t('What Duet tells you about')}
        </label>
        <textarea id="focus" rows={3} value={form.focus} onChange={set('focus')} />
        <p className="hint">{t('Anything else it notices waits for your morning brief.')}</p>
      </fieldset>

      <fieldset>
        <legend>{isPhone ? t('This phone') : t('Phone')}</legend>
        {isPhone ? (
          <>
            <p className="phone-text">{t('Paired with {url}.', { url: connection()?.url ?? '' })}</p>
            <div className="reset">
              <button type="button" className="btn btn-quiet" onClick={onUnpair}>
                {t('Unpair this phone')}
              </button>
            </div>
          </>
        ) : (
          <PhoneAccess />
        )}
      </fieldset>

      <fieldset>
        <legend>{t('Apps')}</legend>
        {isPhone ? (
          <p className="hint">{t('Connect apps from OpenDuet on your computer, in Apps.')}</p>
        ) : (
          <button type="button" className="btn btn-quiet" onClick={onOpenApps}>
            {t('Manage connected apps')}
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend>{t('Memory')}</legend>
        <label htmlFor="memory" className="sr-only">
          {t('What Duet remembers about you')}
        </label>
        <textarea id="memory" rows={7} value={form.memory} onChange={set('memory')} readOnly={memoryLocked} />
        <p className="hint">
          {memoryLocked ? t('Reopen Settings once your computer is reachable to edit this.') : t('Duet reads this before every task. Edit or delete anything.')}
        </p>
      </fieldset>

      <fieldset>
        <legend>{t('Advanced')}</legend>
        <Field id="model" label={t('Model')} hint={t('Any Kilo model id, or nim/<model> for NVIDIA NIM (built-in key). The default costs nothing.')} value={form.model} onChange={set('model')} />
        <div className="field">
          <label htmlFor="kiloMode">{t('How Duet talks to Kilo')}</label>
          <select id="kiloMode" value={form.kiloMode} onChange={(e) => setForm({ ...form, kiloMode: e.target.value as 'api' | 'cli' | 'direct' })} aria-describedby="kiloMode-hint">
            <option value="api">{t('Kilo server (HTTP API)')}</option>
            <option value="cli">{t('Command line (one kilo run per task)')}</option>
            <option value="direct">{t('Kilo hosted API (no Kilo program needed)')}</option>
          </select>
          <p className="hint" id="kiloMode-hint">
            {t(
              "If the Kilo program isn't installed (common on Windows), Duet uses the hosted API on its own. Otherwise the server stays running between tasks, and the command line is the fallback.",
            )}
          </p>
        </div>
        <div className="reset">
          {confirmReset ? (
            <>
              <p>{t("Duet will forget this conversation's context. Your messages stay on screen.")}</p>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  onSave('/new-thread');
                  onClose();
                }}
              >
                {t('Start new thread')}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setConfirmReset(false)}>
                {t('Keep context')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={() => setConfirmReset(true)}>
              {t('Start a new thread…')}
            </button>
          )}
        </div>
      </fieldset>
    </Sheet>
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
