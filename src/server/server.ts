import { acquireCoordinator } from './coordinator.js';
import { app } from './app.js';
import { HOST, PORT, log } from './config.js';
import { closeServer, listen } from './listen.js';
import { stopRemote, syncRemote } from './remote.js';
import { cancelSignIn, writeConnectorsConfig } from './connectors.js';
import { setComputerPort } from './computer/endpoint.js';
import { autoConnectComputer } from './computer/machine.js';
import { dropConnections } from './direct/mcp-client.js';
import { stopKiloServer } from './kilo-api.js';
import { stopBrowser } from './mac/browser.js';
import { startScheduler } from './scheduler.js';
import { db, openStore, writeWorkspaceConfig } from './store.js';

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

/** Opens the store and starts the local server, the scheduler and (if enabled) phone access. */
export async function startServer({ port = PORT }: { port?: number } = {}): Promise<RunningServer> {
  const releaseCoordinator = await acquireCoordinator();
  try {
    await openStore();
    // A copy of the sign-ins left by a crash is deleted; Brave copies fresh ones when next used.
    await stopBrowser();
    const local = await listen(app.fetch, HOST, port);
    // Kilo reaches Duet's computer tools on this server's own port, which is random in the desktop app.
    setComputerPort(local.port);
    await writeConnectorsConfig();
    const cron = startScheduler();
    // Duet's computer is there from the start; tried again every half hour until it connects.
    const connectComputer = async () => {
      if (!(await autoConnectComputer())) return;
      await writeConnectorsConfig();
      await writeWorkspaceConfig();
    };
    void connectComputer();
    const computerRetry = setInterval(() => void connectComputer(), 30 * 60_000);
    computerRetry.unref();
    await syncRemote().catch((err) => log.warn({ err }, 'phone access could not start'));
    log.info(`ThreatDuet on http://${HOST}:${local.port} (model ${db.data.settings.model})`);
    return {
      port: local.port,
      async close() {
        cron.stop();
        clearInterval(computerRetry);
        cancelSignIn();
        stopKiloServer();
        await dropConnections();
        await stopBrowser();
        await stopRemote();
        await closeServer(local.server);
        await releaseCoordinator();
      },
    };
  } catch (e) { await releaseCoordinator(); throw e; }
}
