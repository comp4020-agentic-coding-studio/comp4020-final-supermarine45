import { AnimatePresence, motion } from "framer-motion";
import { KUDOS_ICON } from "./kudosIcons";
import type { KudosToast } from "../hooks/useKudosToasts";

export function KudosToasts({ toasts }: { toasts: KudosToast[] }) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = KUDOS_ICON[toast.emoji as keyof typeof KUDOS_ICON];
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 rounded-md border border-sage/30 bg-sage/10 px-3 py-2 font-mono text-sm text-sage shadow-[var(--shadow-notion-lg)]"
            >
              {Icon ? <Icon size={16} strokeWidth={1.5} /> : <span>{toast.emoji}</span>}
              <span>{toast.fromUsername} sent you kudos</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
