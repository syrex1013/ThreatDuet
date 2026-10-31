import { App as CapApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { StateResponse } from '../../src/shared/types';
import { getState } from './api';
import { apiUrl, isPhone } from './connection';

/**
 * live: receiving change events (desktop, browser). polling: the phone checks every few seconds.
 * reconnecting: the last request failed; the UI keeps showing what it has.
 */
export type ConnectionStatus = 'live' | 'polling' | 'reconnecting';

const CACHE_KEY = 'lastState';
let cached: StateResponse | undefined;

/** The phone opens with the last thread it saw, then refreshes. */
export async function loadCachedState(): Promise<void> {
  if (!isPhone) return;
  const { value } = await Preferences.get({ key: CACHE_KEY });
  if (value) cached = JSON.parse(value) as StateResponse;
}

export function clearCachedState(): void {
  cached = undefined;
  if (isPhone) void Preferences.remove({ key: CACHE_KEY });
}

/** Keeps the state query fresh: a change feed where fetch can stream, polling where it can't. */
export function useLiveState(): { state: StateResponse | undefined; status: ConnectionStatus; error: Error | null } {
  const qc = useQueryClient();
  const [feed, setFeed] = useState<'open' | 'closed'>('closed');
  const wasOpen = useRef(false);

  const query = useQuery({
    queryKey: ['state'],
    queryFn: getState,
    initialData: cached,
    initialDataUpdatedAt: 0,
    // With the feed open, polling is only a safety net.
    refetchInterval: !isPhone && feed === 'open' ? 30_000 : isPhone ? 4_000 : 3_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  // Desktop and browser: an EventSource that reconnects on its own.
  useEffect(() => {
    if (isPhone) return;
    const es = new EventSource(apiUrl('/events'));
    es.onopen = () => {
      setFeed('open');
      // After a reconnect, anything may have changed.
      if (wasOpen.current) void qc.invalidateQueries({ queryKey: ['state'] });
      wasOpen.current = true;
    };
    es.onerror = () => setFeed('closed');
    es.addEventListener('change', (e) => {
      const version = Number((e as MessageEvent).data);
      const current = qc.getQueryData<StateResponse>(['state'])?.version ?? -1;
      if (version !== current) void qc.invalidateQueries({ queryKey: ['state'] });
    });
    return () => es.close();
  }, [qc]);

  // Phone: refresh the moment the app comes back to the foreground, and remember what was shown.
  useEffect(() => {
    if (!isPhone) return;
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void qc.invalidateQueries({ queryKey: ['state'] });
    });
    return () => void sub.then((s) => s.remove());
  }, [qc]);
  useEffect(() => {
    if (!isPhone || !query.data || query.isError) return;
    const { memory: _memory, ...rest } = query.data;
    void Preferences.set({ key: CACHE_KEY, value: JSON.stringify({ ...rest, memory: '', messages: rest.messages.slice(-80) }) });
  }, [query.data, query.isError]);

  const status: ConnectionStatus = query.isError ? 'reconnecting' : !isPhone && feed === 'open' ? 'live' : 'polling';
  return { state: query.data, status, error: query.error };
}
