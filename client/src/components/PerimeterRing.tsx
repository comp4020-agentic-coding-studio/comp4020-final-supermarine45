// Ports room.js's ring-fill math unchanged (it was already minute-agnostic):
// fraction filled = 1 - remainingMs/durationMs, applied as stroke-dashoffset.
const RADIUS = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function PerimeterRing({
  filled,
  color,
  size = 28,
  trackColor = "rgba(255,255,255,0.12)",
}: {
  filled: number;
  color: string;
  size?: number;
  trackColor?: string;
}) {
  const clamped = Math.max(0, Math.min(1, filled));
  const offset = CIRCUMFERENCE * (1 - clamped);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="-rotate-90">
      <circle cx="12" cy="12" r={RADIUS} fill="none" stroke={trackColor} strokeWidth="2.5" />
      <circle
        cx="12"
        cy="12"
        r={RADIUS}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.6s linear" }}
      />
    </svg>
  );
}
