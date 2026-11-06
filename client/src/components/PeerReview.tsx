import { useRef, useState } from "react";
import type { PeerReviewHighlight, PeerReviewHighlightKind } from "../types";

const MAX_DRAFT_WORDS = 200;

const HIGHLIGHT_KINDS: { kind: PeerReviewHighlightKind; label: string; dot: string; mark: string }[] = [
  { kind: "strong", label: "Strong", dot: "bg-sage", mark: "bg-sage/30" },
  { kind: "confusing", label: "Confusing", dot: "bg-amber", mark: "bg-amber/30" },
  { kind: "citation", label: "Needs citation", dot: "bg-terracotta", mark: "bg-terracotta/30" },
];

function draftWordError(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 1) return "paste your draft first";
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  if (words > MAX_DRAFT_WORDS) return `keep it to ${MAX_DRAFT_WORDS} words (currently ${words})`;
  return null;
}

// Writing Clinic-only Peer Review portal (plan §2), opened by the server at
// minute 40 of the Collab Phase. Adapts Whiteboard.tsx's mirror-div technique
// for a read-only surface — reviewers never type into the author's text, only
// drag one of three highlighter "kinds" over it (no typed feedback, per the
// feature's own design: Strong / Confusing / Needs Citation).
export function PeerReview({
  peerReviewOpenedAt,
  myDraftSubmitted,
  myHighlights,
  assignment,
  onSubmitDraft,
  onHighlight,
}: {
  peerReviewOpenedAt: number | null;
  myDraftSubmitted: boolean;
  myHighlights: PeerReviewHighlight[];
  assignment: { authorId: number; authorUsername: string; text: string; highlights: PeerReviewHighlight[] } | null;
  onSubmitDraft: (text: string) => void;
  onHighlight: (authorId: number, start: number, end: number, kind: PeerReviewHighlightKind) => void;
}) {
  const [draftInput, setDraftInput] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<PeerReviewHighlightKind>("strong");
  const textRef = useRef<HTMLDivElement>(null);

  if (!peerReviewOpenedAt) return null;

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const wordErr = draftWordError(draftInput);
    if (wordErr) {
      setDraftError(wordErr);
      return;
    }
    onSubmitDraft(draftInput.trim());
    setDraftError(null);
  }

  function handleMouseUp(): void {
    if (!assignment) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const root = textRef.current;
    if (!root || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return;

    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(root);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + range.toString().length;
    sel.removeAllRanges();
    if (end > start) onHighlight(assignment.authorId, start, end, activeKind);
  }

  function renderHighlighted(text: string, highlights: PeerReviewHighlight[]): React.ReactNode {
    const sorted = [...highlights].sort((a, b) => a.start - b.start);
    const segments: { text: string; kind: PeerReviewHighlightKind | null }[] = [];
    let pos = 0;
    for (const h of sorted) {
      const start = Math.max(pos, Math.min(h.start, text.length));
      const end = Math.max(start, Math.min(h.end, text.length));
      if (start > pos) segments.push({ text: text.slice(pos, start), kind: null });
      if (end > start) segments.push({ text: text.slice(start, end), kind: h.kind });
      pos = Math.max(pos, end);
    }
    if (pos < text.length) segments.push({ text: text.slice(pos), kind: null });
    return segments.map((seg, i) =>
      seg.kind ? (
        <mark key={i} className={`rounded-sm ${HIGHLIGHT_KINDS.find((k) => k.kind === seg.kind)!.mark}`}>
          {seg.text}
        </mark>
      ) : (
        <span key={i}>{seg.text}</span>
      ),
    );
  }

  return (
    <div className="rounded-xl border border-sage/30 bg-white/5 p-4 text-white">
      <h2 className="font-mono text-xs uppercase tracking-widest text-sage">Peer review</h2>

      {!myDraftSubmitted && (
        <form onSubmit={handleSubmit} className="mt-2 space-y-2">
          <p className="text-xs opacity-70">Paste up to {MAX_DRAFT_WORDS} words of your draft for a table-mate to review.</p>
          <textarea
            value={draftInput}
            onChange={(e) => {
              setDraftInput(e.target.value);
              setDraftError(null);
            }}
            placeholder="Paste your draft here&hellip;"
            className="h-32 w-full resize-none rounded-md border border-white/15 bg-transparent p-3 font-mono text-sm text-white outline-none focus:border-sage/50"
          />
          {draftError && <p className="text-xs text-amber">{draftError}</p>}
          <button type="submit" className="rounded-md bg-sage px-4 py-2 text-sm font-medium text-espresso">
            Submit draft
          </button>
        </form>
      )}

      {myDraftSubmitted && !assignment && (
        <p className="mt-2 text-sm opacity-70">Draft submitted — waiting for a table-mate's draft to review.</p>
      )}

      {assignment && (
        <div className="mt-3">
          <p className="text-xs opacity-70">Reviewing {assignment.authorUsername}&rsquo;s draft &mdash; drag to highlight a sentence.</p>
          <div className="mt-2 flex gap-2">
            {HIGHLIGHT_KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => setActiveKind(k.kind)}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                  activeKind === k.kind ? "border-white/60 bg-white/10" : "border-white/15 opacity-60"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${k.dot}`} />
                {k.label}
              </button>
            ))}
          </div>
          <div
            ref={textRef}
            onMouseUp={handleMouseUp}
            className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-white/15 p-3 font-mono text-sm select-text"
          >
            {renderHighlighted(assignment.text, assignment.highlights)}
          </div>
        </div>
      )}

      {myDraftSubmitted && myHighlights.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <p className="text-xs opacity-70">Highlights on your own draft:</p>
          <div className="mt-2 flex gap-2 text-xs">
            {HIGHLIGHT_KINDS.map((k) => {
              const count = myHighlights.filter((h) => h.kind === k.kind).length;
              if (count === 0) return null;
              return (
                <span key={k.kind} className="flex items-center gap-1 opacity-80">
                  <span className={`h-2 w-2 rounded-full ${k.dot}`} /> {count}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
