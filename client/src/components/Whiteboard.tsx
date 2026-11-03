import { useEffect, useRef, useState } from "react";
import type { RosterEntry, WhiteboardHighlight } from "../types";
import type { CursorMap } from "../hooks/useTableSocket";

const CURSOR_FADE_MS = 3000;
const CURSOR_THROTTLE_MS = 50; // ~20Hz, per plan Decision 13 (client self-throttle, never server-side)
const PASTE_DEBOUNCE_MS = 300;

const CURSOR_COLORS = ["#e07a5f", "#10b981", "#d97706", "#60a5fa", "#c084fc", "#f472b6"];
function cursorColor(userId: number): string {
  return CURSOR_COLORS[Math.abs(userId) % CURSOR_COLORS.length];
}

// Problem-Solving-only Breakout Whiteboard (plan §4/§8, Decision 13-14). A
// single shared, continuously-overwritten scratch surface — not chat: no
// sender/recipient, no history, cleared every new focus cycle.
export function Whiteboard({
  isLeader,
  myUserId,
  roster,
  whiteboardOpenedAt,
  whiteboardText,
  whiteboardHighlights,
  cursors,
  now,
  onLaunch,
  onPaste,
  onHighlight,
  onCursor,
}: {
  isLeader: boolean;
  myUserId: number | undefined;
  roster: RosterEntry[];
  whiteboardOpenedAt: number | null;
  whiteboardText: string;
  whiteboardHighlights: WhiteboardHighlight[];
  cursors: CursorMap;
  now: number;
  onLaunch: () => void;
  onPaste: (text: string) => void;
  onHighlight: (start: number, end: number) => void;
  onCursor: (x: number, y: number) => void;
}) {
  const [localText, setLocalText] = useState(whiteboardText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const pasteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCursorEmit = useRef(0);

  useEffect(() => {
    setLocalText(whiteboardText);
  }, [whiteboardText]);

  useEffect(() => {
    return () => {
      if (pasteTimer.current) clearTimeout(pasteTimer.current);
    };
  }, []);

  if (!whiteboardOpenedAt) {
    return (
      <div className="rounded-lg border border-sage/30 bg-white/5 p-4 text-center text-white">
        {isLeader ? (
          <button
            type="button"
            onClick={onLaunch}
            className="rounded-md bg-sage px-4 py-2 text-sm font-medium text-espresso"
          >
            Launch whiteboard
          </button>
        ) : (
          <p className="text-sm opacity-70">Waiting for the pod leader to launch the whiteboard&hellip;</p>
        )}
      </div>
    );
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const next = e.target.value;
    setLocalText(next);
    if (pasteTimer.current) clearTimeout(pasteTimer.current);
    pasteTimer.current = setTimeout(() => onPaste(next), PASTE_DEBOUNCE_MS);
  }

  function handleSelect(): void {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    if (selectionEnd > selectionStart) onHighlight(selectionStart, selectionEnd);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>): void {
    const t = Date.now();
    if (t - lastCursorEmit.current < CURSOR_THROTTLE_MS) return;
    lastCursorEmit.current = t;
    const rect = e.currentTarget.getBoundingClientRect();
    onCursor((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  }

  function handleScroll(): void {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }

  function usernameFor(userId: number): string {
    return roster.find((r) => r.userId === userId)?.username ?? "someone";
  }

  const segments: { text: string; highlighted: boolean }[] = [];
  const sorted = [...whiteboardHighlights].sort((a, b) => a.start - b.start);
  let pos = 0;
  for (const h of sorted) {
    const start = Math.max(pos, Math.min(h.start, localText.length));
    const end = Math.max(start, Math.min(h.end, localText.length));
    if (start > pos) segments.push({ text: localText.slice(pos, start), highlighted: false });
    if (end > start) segments.push({ text: localText.slice(start, end), highlighted: true });
    pos = Math.max(pos, end);
  }
  if (pos < localText.length) segments.push({ text: localText.slice(pos), highlighted: false });

  const liveCursors = Object.values(cursors).filter(
    (c) => c.userId !== myUserId && now - c.updatedAt < CURSOR_FADE_MS,
  );

  return (
    <div className="rounded-lg border border-sage/30 bg-white/5 p-4 text-white">
      <h2 className="font-mono text-xs uppercase tracking-widest text-sage">Breakout whiteboard</h2>
      <div className="relative mt-2 h-40" onMouseMove={handleMouseMove}>
        <div
          ref={backdropRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-transparent p-3 font-mono text-sm text-transparent"
        >
          {segments.map((seg, i) =>
            seg.highlighted ? (
              <mark key={i} className="rounded-sm bg-amber/40 text-transparent">
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={localText}
          onChange={handleChange}
          onSelect={handleSelect}
          onScroll={handleScroll}
          placeholder="Paste the stuck code or problem here&hellip;"
          className="absolute inset-0 h-full w-full resize-none rounded-md border border-white/15 bg-transparent p-3 font-mono text-sm text-white outline-none focus:border-sage/50"
        />
        {liveCursors.map((c) => (
          <div
            key={c.userId}
            className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 transition-opacity duration-300"
            style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cursorColor(c.userId) }} />
            <span className="rounded bg-black/60 px-1 text-[10px] leading-tight" style={{ color: cursorColor(c.userId) }}>
              {usernameFor(c.userId)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs opacity-50">Select text to highlight it for everyone.</p>
    </div>
  );
}
