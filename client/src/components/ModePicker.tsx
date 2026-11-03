import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { ActivityModeInfo, LobbyModeSummary } from "../types";

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

export function ModePicker({
  slug,
  modeInfo,
  summaries,
}: {
  slug: string;
  modeInfo: ActivityModeInfo[];
  summaries: LobbyModeSummary[] | undefined;
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
        return (
          <motion.div key={info.mode} variants={cardVariants} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
            <Link
              to={`/room/${slug}/${info.mode}`}
              className={`group block h-full rounded-lg border border-l-4 border-black/10 bg-white p-4 shadow-sm transition hover:shadow-md ${MODE_ACCENT[info.mode] ?? ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-charcoal">{info.label}</h3>
                {summary && summary.status !== "idle" && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      summary.status === "focus" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {summary.status}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate">{info.description}</p>
              <div className="mt-3 flex items-center gap-3 text-xs text-slate">
                <span>{summary?.occupants ?? 0} here</span>
                <span>&middot;</span>
                <span>{summary?.ticketCount ?? 0}/6 tickets</span>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
