import type { HeatmapEntry } from "../types";

const MS_PER_DAY = 86_400_000;

function colorFor(count: number): string {
  if (count <= 0) return "var(--color-track)";
  if (count === 1) return "#fde68a";
  if (count === 2) return "#d97706";
  return "#92400e";
}

export function HeatmapGrid({ days }: { days: HeatmapEntry[] }) {
  if (days.length === 0) return <p className="text-sm text-ink-muted">No focus blocks completed yet.</p>;

  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const first = new Date(`${days[0].date}T00:00:00Z`);
  const last = new Date(`${days[days.length - 1].date}T00:00:00Z`);
  const leadingEmpty = first.getUTCDay();
  const totalDays = Math.round((last.getTime() - first.getTime()) / MS_PER_DAY) + 1;

  const cells: { date: string | null; count: number }[] = [];
  for (let i = 0; i < leadingEmpty; i++) cells.push({ date: null, count: 0 });
  for (let i = 0; i < totalDays; i++) {
    const iso = new Date(first.getTime() + i * MS_PER_DAY).toISOString().slice(0, 10);
    cells.push({ date: iso, count: byDate.get(iso) ?? 0 });
  }

  return (
    <div
      className="grid gap-[3px] overflow-x-auto py-1"
      style={{ gridTemplateRows: "repeat(7, 10px)", gridAutoFlow: "column", gridAutoColumns: "10px" }}
    >
      {cells.map((cell, i) => (
        <div
          key={i}
          title={cell.date ? `${cell.date}: ${cell.count} VFH` : undefined}
          className="rounded-[2px]"
          style={{ background: cell.date ? colorFor(cell.count) : "transparent" }}
        />
      ))}
    </div>
  );
}
