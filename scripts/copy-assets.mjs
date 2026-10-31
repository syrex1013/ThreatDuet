// tsc only emits .ts files; the browser driver that runs on Duet's cloud computer ships as plain JS.
import { cpSync } from 'node:fs';

cpSync('src/server/computer/vm', 'dist/server/computer/vm', { recursive: true });
