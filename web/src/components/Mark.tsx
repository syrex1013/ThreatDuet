/** The reticle: four corner brackets around a square. ThreatDuet's mark, used as Duet's avatar. */
export function Mark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="6.25" y="6.25" width="3.5" height="3.5" rx="0.5" fill="currentColor" />
    </svg>
  );
}
