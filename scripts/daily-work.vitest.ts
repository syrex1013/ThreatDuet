import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['scripts/daily-work.e2e.ts'], testTimeout: 30_000, hookTimeout: 30_000 } });
