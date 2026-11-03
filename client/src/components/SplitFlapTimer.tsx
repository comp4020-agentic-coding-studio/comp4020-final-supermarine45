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
  const current = useRef(digit);

  useEffect(() => {
    if (digit === current.current) return;
    current.current = digit;
    flipCount.current += 1;
    if (flipCount.current % 2 === 1) setBack(digit);
    else setFront(digit);
    setFlipped(flipCount.current % 2 === 1);
  }, [digit]);

  return (
    <div className="relative h-[1.4em] w-[0.95em] [perspective:400px]">
      <div
        className="absolute inset-0 transition-transform duration-500 [transform-style:preserve-3d]"
        style={{ transform: flipped ? "rotateX(180deg)" : "rotateX(0deg)" }}
      >
        <div className="absolute inset-0 flex items-center justify-center [backface-visibility:hidden]">
          {front}
        </div>
        <div
          className="absolute inset-0 flex items-center justify-center [backface-visibility:hidden]"
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
