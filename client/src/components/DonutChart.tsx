const COLORS = ["#d97706", "#10b981", "#e07a5f", "#1f1d1a", "#8a8a8e"];

export function DonutChart({ entries }: { entries: { label: string; count: number }[] }) {
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  if (total === 0) return <p className="text-sm text-ink-muted">Nothing logged yet.</p>;

  const radius = 15.9155;
  const circumference = 2 * Math.PI * radius;
  const segments = entries.reduce<{ dash: number; offset: number }[]>((acc, e) => {
    const dash = (e.count / total) * circumference;
    const prevOffset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
    acc.push({ dash, offset: prevOffset });
    return acc;
  }, []);

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 36 36" width={100} height={100}>
        <circle cx="18" cy="18" r={radius} fill="none" stroke="var(--color-track)" strokeWidth="4" />
        {entries.map((e, i) => (
          <circle
            key={e.label}
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke={COLORS[i % COLORS.length]}
            strokeWidth="4"
            strokeDasharray={`${segments[i].dash} ${circumference - segments[i].dash}`}
            strokeDashoffset={-segments[i].offset}
            transform="rotate(-90 18 18)"
          />
        ))}
      </svg>
      <ul className="space-y-1 text-sm">
        {entries.map((e, i) => (
          <li key={e.label} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="text-ink">{e.label}</span>
            <span className="text-ink-muted">{e.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
