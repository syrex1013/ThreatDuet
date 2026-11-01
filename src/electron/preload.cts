import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('threatduet', {
  toggleCompact: () => ipcRenderer.send('compact:toggle'),
  onCompact: (cb: (compact: boolean) => void) => {
    ipcRenderer.on('compact', (_e, compact: boolean) => cb(compact));
    ipcRenderer.send('compact:get');
  },
});
