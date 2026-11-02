import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import type { ComputerScreen } from '../../../src/shared/types';
import { getLocalScreen, getScreen, post } from '../api';
import { t } from '../i18n';

type Props = {
  /** Instabox cloud browser, or the ThreatDuet browser on this Mac/Windows/Linux PC. */
  source?: 'computer' | 'local';
  /** When true (computer only), wake a sleeping Instabox machine so the page is visible. */
  wake?: boolean;
  /** Compact layout for the credential prompt. */
  compact?: boolean;
  /** Hide the password field (the parent prompt already collects secrets). */
  hidePassword?: boolean;
};

/** Live browser view for any site: refreshes often; click and type go straight to the page. Works on Windows, macOS and Linux. */
export function LiveBrowser({ source = 'computer', wake = true, compact = false, hidePassword = false }: Props) {
  const local = source === 'local';
  const [text, setText] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [takeover, setTakeover] = useState(false);
  const [woke, setWoke] = useState(wake);
  const img = useRef<HTMLImageElement>(null);
  const shot = useQuery({
    queryKey: [local ? 'local-screen' : 'screen', woke],
    queryFn: () => (local ? getLocalScreen() : getScreen(woke)),
    enabled: true,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });
  const qc = useQueryClient();
  const actPath = local ? '/mac/act' : '/computer/act';
  const send = useMutation({
    mutationFn: (body: object) => post(actPath, { ...body, manual: true }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: [local ? 'local-screen' : 'screen'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  useEffect(() => setError(shot.error ? shot.error.message : null), [shot.error]);

  const d: ComputerScreen | undefined = shot.data;
  const asleep = !local && Boolean(d?.asleep) && !woke;

  const click = (e: MouseEvent<HTMLImageElement>) => {
    const el = img.current;
    if (!el || !el.naturalWidth) return;
    const r = el.getBoundingClientRect();
    const scale = Math.min(r.width / el.naturalWidth, r.height / el.naturalHeight);
    const shownWidth = el.naturalWidth * scale;
    const shownHeight = el.naturalHeight * scale;
    const offsetX = (r.width - shownWidth) / 2;
    const offsetY = (r.height - shownHeight) / 2;
    const x = e.clientX - r.left - offsetX;
    const y = e.clientY - r.top - offsetY;
    if (x < 0 || y < 0 || x > shownWidth || y > shownHeight) return;
    send.mutate({
      action: 'click',
      x: Math.round((x / shownWidth) * el.naturalWidth),
      y: Math.round((y / shownHeight) * el.naturalHeight),
    });
  };

  if (asleep) {
    return (
      <div className="watch-asleep">
        <p className="hint">{t('The computer is asleep. Looking at it wakes it up, and it keeps running until it has been idle for a while.')}</p>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setWoke(true)}>
          {t('Wake it and look')}
        </button>
      </div>
    );
  }

  const pageLabel = local
    ? t('The browser on this computer: {page}', { page: d?.title || d?.url || t('blank page') })
    : t("The browser on Duet's computer: {page}", { page: d?.title || d?.url || t('blank page') });

  return (
    <section className={`watch live-browser${compact ? ' live-browser-compact' : ''}`} aria-label={t('Watch the browser')}>
      {!compact && <h3>{t('Watch')}</h3>}
      {!compact && <button type="button" className="btn btn-quiet btn-sm" onClick={async () => { try { const enabled = d?.browserMode === 'interactive' || takeover; await post(`/browser/${local ? 'local' : 'computer'}/takeover${enabled ? '/finish' : ''}`); setTakeover(!enabled); void qc.invalidateQueries({ queryKey: [local ? 'local-screen' : 'screen'] }); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } }}>{(d?.browserMode === 'interactive' || takeover) ? t('Return to automatic browsing') : t('Take over browser')}</button>}
      <div className="watch-frame">
        {d?.base64 ? (
          <img ref={img} src={`data:${d.mime ?? 'image/jpeg'};base64,${d.base64}`} alt={pageLabel} onClick={click} />
        ) : (
          <div className="skeleton watch-skeleton" aria-label={t('Loading the screen')} />
        )}
      </div>
      <p className="watch-where">
        {d?.title ? `${d.title} · ` : ''}
        {d?.url ?? ''}
      </p>
      <form
        className="watch-type"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!text) return;
          send.mutate({ action: 'type', text, submit: true });
          setText('');
        }}
      >
        <label htmlFor={`live-watch-text-${source}`} className="sr-only">
          {t('Type into the page')}
        </label>
        <input
          id={`live-watch-text-${source}`}
          value={text}
          placeholder={t('Click a field in the picture, then type here')}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="btn btn-quiet btn-sm" disabled={!text || send.isPending}>
          {t('Type and press Enter')}
        </button>
      </form>
      <div className="watch-keys">
        {['Tab', 'Enter', 'Escape', 'PageDown', 'Backspace'].map((k) => (
          <button key={k} type="button" className="btn btn-text btn-sm" onClick={() => send.mutate({ action: 'press', key: k })}>
            {k}
          </button>
        ))}
      </div>
      {!hidePassword && (
        <form
          className="watch-type watch-password"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!password) return;
            send.mutate({ action: 'type', text: password, submit: false });
            setPassword('');
          }}
        >
          <label htmlFor={`live-watch-password-${source}`} className="sr-only">
            {t('Password for this page')}
          </label>
          <input
            id={`live-watch-password-${source}`}
            type="password"
            value={password}
            placeholder={t('Click the password field in the picture, then type here')}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button type="submit" className="btn btn-quiet btn-sm" disabled={!password || send.isPending}>
            {t('Fill password')}
          </button>
        </form>
      )}
      {!compact && (
        <p className="hint">
          {local
            ? t(
                'You are in control here: clicks and typing go straight to the page on this computer without asking. Works for any site. When a site asks for a password, click the field in the picture, type it above, then press Enter with the key below if needed. It never goes into the chat with Duet.',
              )
            : t(
                'You are in control here: clicks and typing go straight to the page without asking. When a site asks for a password, click the field in the picture, type it above, then press Enter with the key below if needed. It never goes into the chat with Duet (it still travels through ThreatDuet to the cloud browser).',
              )}
        </p>
      )}
      {error && (
        <p className="is-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
