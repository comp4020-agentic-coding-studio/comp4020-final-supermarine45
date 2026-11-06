import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { KUDOS_ICON } from "./kudosIcons";

export function KudosButton({
  emoji,
  given,
  disabled,
  onSend,
}: {
  emoji: string;
  given: boolean;
  disabled: boolean;
  onSend: () => void;
}) {
  const [burst, setBurst] = useState(0);
  const Icon = KUDOS_ICON[emoji as keyof typeof KUDOS_ICON];

  function handleClick(): void {
    if (disabled || given) return;
    onSend();
    setBurst((b) => b + 1);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || given}
        className={`flex h-9 w-9 items-center justify-center rounded-full border transition ${
          // The "not given" state is a literal white "paper" circle regardless
          // of chrome theme (same convention as TicketForm/TableDashboard) —
          // the icon/emoji needs an explicit dark color rather than inheriting
          // text-ink, which goes light in dark chrome mode and disappears here.
          given ? "border-sage bg-sage/10 text-sage" : "border-black/15 bg-white text-charcoal hover:scale-110"
        } disabled:cursor-default disabled:opacity-60`}
        aria-label={`send ${emoji} kudos`}
      >
        {Icon ? <Icon size={16} strokeWidth={1.5} /> : emoji}
      </button>
      <AnimatePresence>
        {burst > 0 && (
          <motion.div
            key={burst}
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            {Array.from({ length: 6 }).map((_, i) => {
              const angle = (i / 6) * Math.PI * 2;
              return (
                <motion.span
                  key={i}
                  className="absolute"
                  initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                  animate={{
                    x: Math.cos(angle) * 24,
                    y: Math.sin(angle) * 24,
                    opacity: 0,
                    scale: 0.5,
                  }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                  onAnimationComplete={() => setBurst(0)}
                >
                  {Icon ? <Icon size={12} strokeWidth={1.5} /> : emoji}
                </motion.span>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
