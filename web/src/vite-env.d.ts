/// <reference types="vite/client" />

interface ThreatDuetBridge {
  toggleCompact: () => void;
  onCompact: (cb: (compact: boolean) => void) => void;
}

interface Window {
  threatduet?: ThreatDuetBridge;
}
