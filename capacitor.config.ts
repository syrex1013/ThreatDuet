import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tech.threatvector.threatduet',
  appName: 'ThreatDuet',
  webDir: 'web/dist',
  // Debug builds would otherwise print plugin calls, including the pairing link and its token, to logcat.
  loggingBehavior: 'none',
  plugins: {
    // Requests go through Android's native HTTP stack: no CORS, and the paired computer needs no extra headers.
    CapacitorHttp: { enabled: true },
    // Light UI: dark status-bar icons. Insets reach CSS as env() or --safe-area-inset-* (see app.css).
    SystemBars: { style: 'LIGHT' },
    // Checks the computer for news while the app is closed. Android runs it about every 15 minutes.
    BackgroundRunner: {
      label: 'tech.threatvector.threatduet.check',
      src: 'runners/duet.js',
      event: 'check',
      repeat: true,
      interval: 15,
      autoStart: true,
    },
  },
};

export default config;
