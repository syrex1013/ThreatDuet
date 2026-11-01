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

export const getFiles = () => request<{ files: { path: string; size: number; mtime: number }[] }>('/files');

export const getRemote =() => request<RemoteInfo>('/remote');

export const getConnectors = (refresh = false) => request<ConnectorsResponse>(`/connectors${refresh ? '?refresh=1' : ''}`);

export const getComputer = () => request<ComputerStatus>('/computer');

export const getScreen = (wake = false) => request<ComputerScreen>(`/computer/screen${wake ? '?wake=1' : ''}`);

export const getLocalScreen = () => request<ComputerScreen>('/mac/screen');

export async function fileBlob(path: string): Promise<Blob> {
  const response = await fetch(apiUrl(`/artifacts/download?path=${encodeURIComponent(path)}`), { headers: authHeaders() });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  return response.blob();
}

export async function downloadFile(path: string): Promise<void> {
  const url = URL.createObjectURL(await fileBlob(path));
  const link = document.createElement('a');
  link.href = url;
  link.download = path.split('/').at(-1) || 'download';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
