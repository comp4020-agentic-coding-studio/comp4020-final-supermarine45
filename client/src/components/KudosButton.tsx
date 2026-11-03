import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

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
        className={`flex h-9 w-9 items-center justify-center rounded-full border text-lg transition ${
          given ? "border-sage bg-sage/10" : "border-black/15 bg-white hover:scale-110"
        } disabled:cursor-default disabled:opacity-60`}
        aria-label={`send ${emoji} kudos`}
      >
        {emoji}
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
                  className="absolute text-xs"
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
                  {emoji}
                </motion.span>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
