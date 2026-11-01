import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Message, StateResponse } from '../../../src/shared/types';
import { t } from '../i18n';

interface ChannelsProps {
  channels: StateResponse['channels'];
  messages: Message[];
  active: string | undefined;
  onSelect: (id: string | undefined) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
}

const latestReply = (messages: Message[], channel: string | undefined) =>
  Math.max(0, ...messages.filter((m) => m.channel === channel && m.role === 'duet').map((m) => m.ts));

/** Main plus one chip per topic. A dot marks a channel with a reply you haven't opened. */
export function Channels({ channels, messages, active, onSelect, onCreate, onDelete }: ChannelsProps) {
  const openedAt = useRef(Date.now());
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const key = active ?? '';
  const activeLatest = latestReply(messages, active);
  useEffect(() => {
    setSeen((s) => (s[key] === activeLatest ? s : { ...s, [key]: activeLatest }));
  }, [key, activeLatest]);

  const unread = (id: string | undefined) => latestReply(messages, id) > Math.max(seen[id ?? ''] ?? 0, openedAt.current);
  const chip = (id: string | undefined, label: string) => (
    <button key={id ?? ''} type="button" className={`channel ${id === active ? 'is-active' : ''}`} aria-pressed={id === active} onClick={() => onSelect(id)}>
      {label}
      {id !== active && unread(id) && <span className="channel-dot" aria-label={t('new reply')} />}
    </button>
  );

  const create = () => {
    const n = name.trim().replace(/^#+/, '').trim();
    if (n) onCreate(n);
    setName('');
    setAdding(false);
  };

  return (
    <nav className="channels" aria-label={t('Channels')}>
      {chip(undefined, t('Main'))}
      {channels.map((c) => chip(c.id, `#${c.name}`))}
      {active && (
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => onDelete(active)} aria-label={t('Close this channel (its messages move to Main)')} title={t('Close channel, messages move to Main')}>
          <X size={15} aria-hidden="true" />
        </button>
      )}
      {adding ? (
        <input
          className="channel-input"
          autoFocus
          maxLength={40}
          value={name}
          placeholder={t('Channel name')}
          aria-label={t('New channel name')}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => !name.trim() && setAdding(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') create();
            if (e.key === 'Escape') {
              setName('');
              setAdding(false);
            }
          }}
        />
      ) : (
        <button type="button" className="icon-btn icon-btn-sm" onClick={() => setAdding(true)} aria-label={t('New channel')} title={t('New channel')}>
          <Plus size={15} aria-hidden="true" />
        </button>
      )}
    </nav>
  );
}
