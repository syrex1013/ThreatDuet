import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { ConnectorInfo, ConnectorsResponse, ConnectorState } from '../../../src/shared/types';
import { PRESETS, type ConnectorPreset } from '../../../src/shared/connectors';
import { getConnectors, post } from '../api';
import { t } from '../i18n';
import { Browse, Import, SkillsSection } from './Market';
import { Sheet } from './Sheet';

const STATE_TEXT: Record<ConnectorState, string> = {
  connected: 'Connected',
  'needs-sign-in': 'Sign-in needed',
  'signing-in': 'Waiting for you to sign in',
  off: 'Off',
  error: 'Not reachable',
  unknown: 'Checking…',
};

/** Connect the apps Duet watches. Lives on the computer only: sign-in opens a browser here. */
export function AppsSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const apps = useQuery({
    queryKey: ['connectors'],
    queryFn: () => getConnectors(),
    refetchInterval: (q) => (q.state.data?.signIn || q.state.data?.connectors.some((c) => c.state === 'unknown') ? 2000 : false),
  });
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: ([path, body]: [string, unknown]) => post<{ id?: string; warning?: string }>(path, body),
    onError: (e) => setError(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: ['connectors'] }),
  });
  const run = (path: string, body: unknown = {}) => act.mutateAsync([path, body]).catch(() => undefined);

  /** Adds an app; OAuth apps go straight to sign-in so connecting is one step. */
  const connect = async (body: ConnectBody, oauth: boolean) => {
    const r = await run('/connectors', body);
    if (r?.id && oauth) await run('/connectors/sign-in', { id: r.id });
    // Skill install can fail after the app is already connected; keep that note visible.
    if (r?.warning) setError(r.warning);
    else if (r?.id) setError(null);
  };

  const data = apps.data;
  const added = new Set(data?.connectors.map((c) => c.presetId) ?? []);
  const [tab, setTab] = useState<'popular' | 'browse' | 'import' | 'custom'>('popular');

  return (
    <Sheet title={t('Apps')} wide onClose={onClose}>
      <p className="apps-intro">
        {t(
          'Connect the apps Duet should watch. It reads them on its own and asks before it sends, changes or deletes anything. You sign in in your browser; Duet never sees your passwords.',
        )}
      </p>

      {data?.signIn && <SignInBanner data={data} onCancel={() => run('/connectors/cancel-sign-in')} />}
      {(error || data?.lastError) && (
        <p className="is-error apps-error" role="alert">
          {error ?? data?.lastError?.message}
        </p>
      )}

      {data && data.connectors.length > 0 && (
        <section className="apps-section" aria-label={t('Your apps')}>
          <h3>{t('Your apps')}</h3>
          <ul className="apps-list">
            {data.connectors.map((c) => (
              <AppRow key={c.id} app={c} busy={act.isPending} run={run} />
            ))}
          </ul>
        </section>
      )}

      {PRESETS.some((p) => p.kind === 'payment' && !added.has(p.id)) && (
        <section className="apps-section" aria-label={t('Payments')}>
          <h3>{t('Payments')}</h3>
          <p className="hint">
            {t(
              'Buy things with Link or Shop Pay. Duet confirms the item with you here; Link or Shop asks you again before charging, and pays with a one-time card so your real card number is never shared with Duet.',
            )}
          </p>
          <div className="catalog">
            {PRESETS.filter((p) => p.kind === 'payment' && !added.has(p.id)).map((p) => (
              <PresetCard key={p.id} preset={p} busy={act.isPending} onConnect={connect} />
            ))}
          </div>
        </section>
      )}

      <section className="apps-section" aria-label={t('Add an app')}>
        <h3>{t('Add an app')}</h3>
        <div className="tabs" role="tablist">
          {(
            [
              ['popular', 'Popular'],
              ['browse', 'Browse all'],
              ['import', 'From Claude or Codex'],
              ['custom', 'Your own'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`btn btn-text btn-sm ${tab === id ? 'is-on' : ''}`} onClick={() => setTab(id)}>
              {t(label)}
            </button>
          ))}
        </div>
        {tab === 'popular' && (
          <div className="catalog">
            {PRESETS.filter((p) => (p.kind ?? 'app') !== 'payment' && !added.has(p.id)).map((p) => (
              <PresetCard key={p.id} preset={p} busy={act.isPending} onConnect={connect} />
            ))}
          </div>
        )}
        {tab === 'browse' && <Browse />}
        {tab === 'import' && <Import />}
        {tab === 'custom' && <CustomApp busy={act.isPending} onConnect={connect} />}
      </section>

      <SkillsSection />

      <section className="apps-section" aria-label={t('Web pages')}>
        <h3>{t('Web pages')}</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={data?.openWebPages ?? false}
            onChange={(e) => run('/connectors/web', { openWebPages: e.target.checked })}
          />
          <span>
            {t('Let Duet open web pages on its own')}
            <span className="hint">
              {t(
                'With apps connected, a malicious email could ask Duet to open a link that carries your data out. While this is off, Duet asks before opening pages. Web search still works.',
              )}
            </span>
          </span>
        </label>
      </section>

      <p className="hint apps-privacy">
        {t(
          'Whatever Duet reads in these apps goes to the AI model set in Settings. Free models may be served by providers that keep what they receive; choose a model with no-retention terms for real accounts.',
        )}
      </p>
    </Sheet>
  );
}

function SignInBanner({ data, onCancel }: { data: ConnectorsResponse; onCancel: () => void }) {
  const name = data.connectors.find((c) => c.id === data.signIn?.id)?.name ?? t('the app');
  return (
    <div className="signin" role="status">
      <span className="pulse" aria-hidden="true" />
      <div className="signin-text">
        <strong>{t('Finish signing in to {name} in your browser.', { name })}</strong>
        <span className="hint">{t("The page should have opened. If it didn't, open it here.")}</span>
      </div>
      {data.signIn?.url && (
        <a className="btn btn-quiet" href={data.signIn.url} target="_blank" rel="noreferrer noopener">
          <ExternalLink size={15} aria-hidden="true" /> {t('Open sign-in page')}
        </a>
      )}
      <button type="button" className="btn btn-text" onClick={onCancel}>
        {t('Cancel')}
      </button>
    </div>
  );
}

function AppRow({ app, busy, run }: { app: ConnectorInfo; busy: boolean; run: (path: string, body?: unknown) => Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={`app-row state-${app.state}`}>
      <span className="app-badge" aria-hidden="true">
        {app.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="app-main">
        <div className="app-name">
          {app.name} <span className="muted">{app.site}</span>
        </div>
        <div className="app-state">
          {t(STATE_TEXT[app.state])}
          {app.state === 'error' && app.detail ? `: ${app.detail}` : ''}
        </div>
        <div className="app-controls">
          {app.state === 'needs-sign-in' && (
            <button type="button" className="btn btn-approve btn-sm" disabled={busy} onClick={() => run('/connectors/sign-in', { id: app.id })}>
              {t('Sign in')}
            </button>
          )}
          <label className="check check-inline">
            <input type="checkbox" checked={app.enabled} onChange={(e) => run('/connectors/update', { id: app.id, enabled: e.target.checked })} />
            <span>{t('On')}</span>
          </label>
          <label className="check check-inline">
            <input
              type="checkbox"
              checked={app.autoRead}
              disabled={!app.enabled}
              onChange={(e) => run('/connectors/update', { id: app.id, autoRead: e.target.checked })}
            />
            <span>{t('Reads on its own')}</span>
          </label>
          {confirming ? (
            <span className="confirm">
              {t('Sign out and remove {name}?', { name: app.name })}
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => run('/connectors/remove', { id: app.id })}>
                {t('Remove')}
              </button>
              <button type="button" className="btn btn-text btn-sm" onClick={() => setConfirming(false)}>
                {t('Keep')}
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-text btn-sm" onClick={() => setConfirming(true)}>
              {t('Remove…')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

type ConnectBody = { name: string; url?: string; command?: string[]; env?: Record<string, string>; confirmed?: boolean; presetId?: string | null; header?: { name: string; value: string } };
type ConnectFn = (body: ConnectBody, oauth: boolean) => Promise<void>;

function PresetCard({ preset, busy, onConnect }: { preset: ConnectorPreset; busy: boolean; onConnect: ConnectFn }) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const needsInput = preset.auth === 'key' || preset.auth === 'personal-url' || preset.auth === 'local';

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (preset.auth === 'local' && preset.command?.length)
      return void onConnect({ name: preset.name, command: preset.command, presetId: preset.id, confirmed: true }, false);
    if (preset.auth === 'personal-url') return void onConnect({ name: preset.name, url: secret.trim(), presetId: preset.id }, false);
    if (preset.auth === 'key')
      return void onConnect(
        {
          name: preset.name,
          url: preset.url,
          presetId: preset.id,
          header: { name: preset.keyHeader ?? 'Authorization', value: preset.keyPrefix ? `${preset.keyPrefix}${secret.trim()}` : secret.trim() },
        },
        false,
      );
    void onConnect({ name: preset.name, url: preset.url, presetId: preset.id }, preset.auth === 'oauth');
  };

  return (
    <div className={`preset ${open ? 'is-open' : ''}`}>
      <button type="button" className="preset-head" disabled={busy} onClick={() => (needsInput ? setOpen(!open) : submit())}>
        <span className="app-badge" aria-hidden="true">
          {preset.name.slice(0, 1)}
        </span>
        <span className="preset-text">
          <span className="preset-name">{preset.name}</span>
          <span className="preset-blurb">{t(preset.blurb)}</span>
        </span>
        <Plus size={16} aria-hidden="true" className="preset-plus" />
      </button>
      {open && needsInput && preset.auth === 'local' && preset.command?.length && (
        <form className="preset-form" onSubmit={submit}>
          <p className="warning">
            {t(
              'This runs on your computer with your permissions. Duet reads on its own only through read-only tools; anything that changes something waits for your approval.',
            )}
          </p>
          <code className="command">{preset.command.join(' ')}</code>
          <button type="submit" className="btn btn-send btn-sm" disabled={busy}>
            {t('Connect {name}', { name: preset.name })}
          </button>
        </form>
      )}
      {open && needsInput && preset.auth !== 'local' && (
        <form className="preset-form" onSubmit={submit}>
          <label htmlFor={`k-${preset.id}`}>{preset.keyLabel && t(preset.keyLabel)}</label>
          <input
            id={`k-${preset.id}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          {preset.keyHelp && (
            <a className="hint" href={preset.keyHelp} target="_blank" rel="noreferrer noopener">
              {t('Where to find it')} <ExternalLink size={12} aria-hidden="true" />
            </a>
          )}
          <button type="submit" className="btn btn-send btn-sm" disabled={!secret.trim() || busy}>
            {t('Connect {name}', { name: preset.name })}
          </button>
        </form>
      )}
    </div>
  );
}

/** "npx -y pkg --root '/my dir'" to argv. Quotes group words; nothing else is interpreted. */
const splitCommand = (line: string) => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

function CustomApp({ busy, onConnect }: { busy: boolean; onConnect: ConnectFn }) {
  const [program, setProgram] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [envText, setEnvText] = useState('');
  const [keyName, setKeyName] = useState('Authorization');
  const [keyValue, setKeyValue] = useState('');
  const argv = splitCommand(command);
  const env = Object.fromEntries(
    envText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
  const ready = name.trim() && (program ? argv.length > 0 : url.trim());
  return (
    <form
      className="custom-app"
      onSubmit={(e) => {
        e.preventDefault();
        if (program) void onConnect({ name: name.trim(), command: argv, env, confirmed: true }, false);
        else void onConnect({ name: name.trim(), url: url.trim(), header: keyValue.trim() ? { name: keyName.trim(), value: keyValue.trim() } : undefined }, !keyValue.trim());
      }}
    >
      <div className="tabs" role="radiogroup" aria-label={t('How the app is reached')}>
        <button type="button" role="radio" aria-checked={!program} className={`btn btn-text btn-sm ${!program ? 'is-on' : ''}`} onClick={() => setProgram(false)}>
          {t('Server address')}
        </button>
        <button type="button" role="radio" aria-checked={program} className={`btn btn-text btn-sm ${program ? 'is-on' : ''}`} onClick={() => setProgram(true)}>
          {t('Program on this computer')}
        </button>
      </div>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="custom-name">{t('Name')}</label>
          <input id="custom-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {!program && (
          <div className="field">
            <label htmlFor="custom-url">{t('Server address')}</label>
            <input id="custom-url" inputMode="url" placeholder="https://mcp.example.com/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}
      </div>
      {program ? (
        <>
          <div className="field">
            <label htmlFor="custom-cmd">{t('Command')}</label>
            <input id="custom-cmd" spellCheck={false} placeholder="npx -y @org/mail-mcp" value={command} onChange={(e) => setCommand(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="custom-env">{t('Environment variables (one per line, NAME=value)')}</label>
            <textarea id="custom-env" rows={3} spellCheck={false} autoComplete="off" value={envText} onChange={(e) => setEnvText(e.target.value)} />
          </div>
          <p className="warning">
            {t(
              'This runs on your computer with your permissions. Duet reads on its own only through read-only tools; anything that changes something waits for your approval.',
            )}
          </p>
          {argv.length > 0 && <code className="command">{argv.join(' ')}</code>}
        </>
      ) : (
        <details className="custom-key">
          <summary>{t('This app uses an access key instead of a sign-in')}</summary>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="custom-key-name">{t('Header')}</label>
              <input id="custom-key-name" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="custom-key-value">{t('Value')}</label>
              <input id="custom-key-value" type="password" autoComplete="off" placeholder="Bearer …" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} />
            </div>
          </div>
        </details>
      )}
      <div className="reset">
        <button type="submit" className="btn btn-send btn-sm" disabled={busy || !ready}>
          {program ? t('Run on this computer and connect') : t('Connect')}
        </button>
      </div>
    </form>
  );
}
