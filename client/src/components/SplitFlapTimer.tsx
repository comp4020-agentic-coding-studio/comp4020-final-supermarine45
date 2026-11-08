import { AnimatePresence, motion } from "framer-motion";

// Port of public/js/room.js's FlipDigit/FlipClock. The original 3D
// rotateX(180deg) flip-card (two backface-hidden faces stacked under a
// shared perspective) rendered corrupted/overlapping glyphs in Firefox —
// a known cross-browser hazard of stacking two backface-hidden 3D faces
// under one perspective, worse once a fast digit change interrupted the
// transform mid-flight. Framer Motion's AnimatePresence sidesteps the
// whole class of bug: no 3D stacking, no backface-visibility, and it
// already handles an interrupting digit change (a new key) by smoothly
// re-animating from whatever offset/opacity the previous exit had reached,
// instead of corrupting the render.
function FlipDigit({ digit }: { digit: string }) {
  return (
    <div className="relative h-[1.4em] w-[0.95em] overflow-hidden">
      <AnimatePresence initial={false}>
        <motion.div
          key={digit}
          initial={{ y: "-60%", opacity: 0 }}
          animate={{ y: "0%", opacity: 1 }}
          exit={{ y: "60%", opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {digit}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function SplitFlapTimer({ minutes, className = "" }: { minutes: number; className?: string }) {
  const clamped = Math.max(0, Math.min(99, minutes));
  const [tens, ones] = String(clamped).padStart(2, "0").split("");
  return (
    <div className={`flex items-center font-mono tabular-nums ${className}`}>
      <FlipDigit digit={tens} />
      <FlipDigit digit={ones} />
      <span className="ml-2 text-[0.5em] opacity-70">m</span>
    </div>
  );
}
