import { useEffect, useRef, useState } from "react";

// Port of public/js/room.js's FlipDigit/FlipClock: a 3D CSS-transform flip
// card per digit. The one deliberate behavior change from the legacy
// version is granularity — CLAUDE.md bans ticking seconds ("Minutes only,
// e.g. 42m"), so this renders two digits of whole minutes and only re-flips
// when that integer actually changes, not on every second's tick.
function FlipDigit({ digit }: { digit: string }) {
  const [front, setFront] = useState(digit);
  const [back, setBack] = useState(digit);
  const [flipped, setFlipped] = useState(false);
  const flipCount = useRef(0);
  // The last digit value we've committed to displaying, whether the flip to
  // it has already started or is still pending — distinct from `animatingRef`
  // (is a flip currently in flight) and `pendingDigitRef` (a newer digit that
  // arrived while one was).
  const targetRef = useRef(digit);
  const animatingRef = useRef(false);
  const pendingDigitRef = useRef<string | null>(null);

  function startFlip(next: string): void {
    flipCount.current += 1;
    animatingRef.current = true;
    if (flipCount.current % 2 === 1) setBack(next);
    else setFront(next);
    setFlipped(flipCount.current % 2 === 1);
  }

  useEffect(() => {
    if (digit === targetRef.current) return;
    targetRef.current = digit;
    if (animatingRef.current) {
      // A digit arriving mid-flip would otherwise yank the in-flight 3D
      // transform out from under itself (interrupting rotateX partway and
      // reversing it), which is what produced the corrupted/overlapping
      // glyph — defer it to this flip's own onTransitionEnd instead.
      pendingDigitRef.current = digit;
    } else {
      startFlip(digit);
    }
  }, [digit]);

  function handleTransitionEnd(e: React.TransitionEvent<HTMLDivElement>): void {
    if (e.target !== e.currentTarget) return;
    animatingRef.current = false;
    const pending = pendingDigitRef.current;
    pendingDigitRef.current = null;
    if (pending !== null) startFlip(pending);
  }

  return (
    <div className="relative h-[1.4em] w-[0.95em] [perspective:400px]">
      <div
        className="absolute inset-0 transition-transform duration-500 [transform-style:preserve-3d] [-webkit-transform-style:preserve-3d]"
        style={{ transform: flipped ? "rotateX(180deg)" : "rotateX(0deg)" }}
        onTransitionEnd={handleTransitionEnd}
      >
        <div className="absolute inset-0 flex items-center justify-center [backface-visibility:hidden] [-webkit-backface-visibility:hidden]">
          {front}
        </div>
        <div
          className="absolute inset-0 flex items-center justify-center [backface-visibility:hidden] [-webkit-backface-visibility:hidden]"
          style={{ transform: "rotateX(180deg)" }}
        >
          {back}
        </div>
      </div>
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
