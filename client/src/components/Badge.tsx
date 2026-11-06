export type BadgeTone = "sage" | "amber" | "violet" | "neutral" | "rose";

const TONE_CLASSES: Record<BadgeTone, string> = {
  sage: "bg-sage/15 text-sage-dim",
  amber: "bg-amber/15 text-amber-dim",
  violet: "bg-violet-500/15 text-violet-700",
  neutral: "bg-surface-muted text-ink-muted",
  rose: "bg-rose-500/15 text-rose-700",
};

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>{children}</span>
  );
}
