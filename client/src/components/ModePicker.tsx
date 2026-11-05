import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { ActivityModeInfo, LobbyModeSummary } from "../types";
import { ModeIcon } from "./icons";
import { PerimeterRing } from "./PerimeterRing";
import { ringColor } from "./TableDashboard";
import { Avatar } from "./Avatar";

const MODE_ACCENT: Record<string, string> = {
  silent: "border-l-amber-600",
  writing: "border-l-sage-dim",
  pitch: "border-l-terracotta",
  problem: "border-l-charcoal",
};

const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

// Same math as TableDashboard's own `elapsed` (Decision: reuse, don't
// reinvent) — 0 while idle so the ring just reads empty for a quiet mode.
function elapsedFor(summary: LobbyModeSummary | undefined, now: number): number {
  const timer = summary?.timer;
  if (!timer || !timer.phaseEndAt || !timer.durationMs) return 0;
  if (timer.status !== "focus" && timer.status !== "break") return 0;
  return 1 - Math.max(0, timer.phaseEndAt - now) / timer.durationMs;
}

export function ModePicker({
  slug,
  modeInfo,
  summaries,
  now,
}: {
  slug: string;
  modeInfo: ActivityModeInfo[];
  summaries: LobbyModeSummary[] | undefined;
  now: number;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={gridVariants}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {modeInfo.map((info) => {
        const summary = summaries?.find((s) => s.mode === info.mode);
        const roster = summary?.roster ?? [];
        const shadowCount = summary?.shadowCount ?? 0;
        return (
          <motion.div key={info.mode} variants={cardVariants} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
            <Link
              to={`/room/${slug}/${info.mode}`}
              className={`group block h-full rounded-lg border border-l-4 border-line bg-surface p-4 shadow-sm transition hover:shadow-md ${MODE_ACCENT[info.mode] ?? ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="flex items-center gap-2 font-semibold text-ink">
                  <ModeIcon mode={info.mode} className="text-base text-ink-muted" />
                  {info.label}
                </h3>
                <div className="flex items-center gap-2">
                  {summary && summary.status !== "idle" && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        summary.status === "focus" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {summary.status}
                    </span>
                  )}
                  {summary && summary.status !== "idle" && (
                    <PerimeterRing filled={elapsedFor(summary, now)} color={ringColor(summary.timer)} size={20} trackColor="rgba(0,0,0,0.1)" />
                  )}
                </div>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{info.description}</p>
              <div className="mt-3 flex items-center gap-3 text-xs text-ink-muted">
                <span>{summary?.occupants ?? 0} here</span>
                <span>&middot;</span>
                <span>{summary?.ticketCount ?? 0}/6 tickets</span>
              </div>
              {(roster.length > 0 || shadowCount > 0) && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                  {roster.map((r) => (
                    <Avatar key={r.userId} name={r.username} size={20} />
                  ))}
                  {shadowCount > 0 && <span className="text-xs text-ink-muted">+{shadowCount} watching</span>}
                </div>
              )}
            </Link>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
