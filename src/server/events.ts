import { EventEmitter } from 'node:events';

/** In-process change feed: anything that alters what the UI shows bumps the version, and SSE clients refetch. */
const bus = new EventEmitter();
bus.setMaxListeners(200);
let version = 0;

export const stateVersion = () => version;

export function stateChanged(): void {
  version++;
  bus.emit('change', version);
}

export function onStateChange(fn: (version: number) => void): () => void {
  bus.on('change', fn);
  return () => bus.off('change', fn);
}
