import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useState } from 'react';
import type { RemoteInfo } from '../../../src/shared/types';
import { getRemote, post } from '../api';
import { pairLink } from '../connection';
import { t } from '../i18n';

/** Desktop settings: let the phone app reach this computer, and show the code to pair it. */
export function PhoneAccess() {
  const qc = useQueryClient();
  const remote = useQuery({ queryKey: ['remote'], queryFn: getRemote });
  const [chosen, setChosen] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: (body: { enabled?: boolean; rotate?: boolean; phoneCommands?: boolean }) => post<RemoteInfo>('/remote', body),
    onSuccess: (info) => qc.setQueryData(['remote'], info),
  });

  const info = remote.data;
  const address = info?.addresses.find((a) => a.address === chosen) ?? info?.addresses[0];
  const url = info && address ? `http://${address.address}:${info.port}` : null;
  const link = info?.enabled && info.token && url ? pairLink(url, info.token) : null;
  const qr = useQuery({
    queryKey: ['qr', link],
    queryFn: () => QRCode.toDataURL(link!, { margin: 1, width: 232, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }),
    enabled: Boolean(link),
  });

  if (!info) return <p className="hint">{remote.error?.message ?? t('Checking phone access…')}</p>;

  if (!info.enabled)
    return (
      <>
        <p className="phone-text">
          {t('Get briefs, approvals and replies on your phone. This computer still does the work, so leave OpenDuet running.')}
        </p>
        <button type="button" className="btn btn-quiet" onClick={() => change.mutate({ enabled: true })} disabled={change.isPending}>
          {t('Turn on phone access')}
        </button>
        {change.error && <p className="is-error hint">{change.error.message}</p>}
      </>
    );

  return (
    <>
      {info.addresses.length === 0 ? (
        <p className="is-error hint">{t("This computer isn't on a network your phone can reach. Connect to Wi-Fi or start Tailscale.")}</p>
      ) : (
        <>
          {info.addresses.length > 1 && (
            <div className="field" role="radiogroup" aria-label={t('Address your phone uses')}>
              <p className="field-label">{t('Address your phone uses')}</p>
              {info.addresses.map((a) => (
                <label key={a.address} className="radio">
                  <input type="radio" name="phone-address" checked={a.address === address?.address} onChange={() => setChosen(a.address)} />
                  {a.address} <span className="muted">{a.kind === 'tailscale' ? t('(Tailscale, encrypted)') : t('(local network)')}</span>
                </label>
              ))}
            </div>
          )}
          {address?.kind === 'lan' && (
            <p className="warning">
              {t(
                'On a local network, anyone on the same Wi-Fi could read the pairing code from the traffic and act as you. Use Tailscale, or pair only on a network you trust.',
              )}
            </p>
          )}
          <div className="pairing">
            {qr.data && <img className="qr" src={qr.data} width={232} height={232} alt={t('Pairing code for the OpenDuet phone app')} />}
            <div>
              <p className="phone-text">{t("Scan with your phone's camera. It opens the OpenDuet app and pairs it.")}</p>
              <p className="hint">{t('Or enter these in the app:')}</p>
              <dl className="manual">
                <dt>{t('Computer address')}</dt>
                <dd>
                  <code>{url}</code>
                </dd>
                <dt>{t('Pairing code')}</dt>
                <dd>
                  <code className="token">{info.token}</code>
                </dd>
              </dl>
            </div>
          </div>
        </>
      )}

      <label className="check" style={{ marginTop: '1rem' }}>
        <input
          type="checkbox"
          checked={Boolean(info.phoneCommands)}
          disabled={change.isPending}
          onChange={(e) => change.mutate({ phoneCommands: e.target.checked })}
        />
        <span>
          {t('Use fully from phone')}
          <span className="hint">
            {t(
              'Approve commands that run on this computer, watch its browser, and sign into sites from your phone. Leave OpenDuet running here. Anyone with a paired phone can act as you.',
            )}
          </span>
        </span>
      </label>

      <div className="reset">
        <button type="button" className="btn btn-quiet" onClick={() => change.mutate({ rotate: true })} disabled={change.isPending}>
          {t('Unpair all phones')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => change.mutate({ enabled: false })} disabled={change.isPending}>
          {t('Turn off phone access')}
        </button>
      </div>
      {change.error && <p className="is-error hint">{change.error.message}</p>}
    </>
  );
}
