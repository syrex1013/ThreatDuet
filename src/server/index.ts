import os from 'node:os';
import { startServer } from './server.js';

// A signal's default action skips 'exit', so the hooks that stop kilo serve and the sign-in process would never run.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(sig, () => process.exit(128 + os.constants.signals[sig]));

await startServer();
