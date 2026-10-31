import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { isPhone, loadConnection } from './connection';
import { loadCachedState } from './live';
import '@fontsource-variable/saira/wdth.css';
import './app.css';

// The desktop app loads the UI with ?shell=mac|desktop so CSS can make room for native window chrome.
const shell = isPhone ? 'phone' : new URLSearchParams(location.search).get('shell');
if (shell) document.documentElement.dataset.shell = shell;

const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

async function boot() {
  await loadConnection();
  await loadCachedState();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void boot();
