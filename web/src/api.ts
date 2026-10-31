import type { ComputerScreen, ComputerStatus, ConnectorsResponse, RemoteInfo, StateResponse } from '../../src/shared/types';
import { apiUrl, authHeaders } from './connection';

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(path), { ...init, headers: { ...authHeaders(), ...init.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message ?? json.error ?? `${res.status} ${res.statusText}`);
  return json as T;
}

export const post = <T = { ok: true }>(path: string, body: unknown = {}) =>
  request<T>(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-duet': '1' }, body: JSON.stringify(body) });

export const getState = () => request<StateResponse>('/state');

export const getFile = (path: string) => request<{ path: string; text: string }>(`/file?path=${encodeURIComponent(path)}`);

export const getRemote = () => request<RemoteInfo>('/remote');

export const getConnectors = (refresh = false) => request<ConnectorsResponse>(`/connectors${refresh ? '?refresh=1' : ''}`);

export const getComputer = () => request<ComputerStatus>('/computer');

export const getScreen = (wake = false) => request<ComputerScreen>(`/computer/screen${wake ? '?wake=1' : ''}`);
