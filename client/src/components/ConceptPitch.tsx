import { useEffect, useState } from "react";

const MAX_PITCH_WORDS = 200;
const MAX_COMMENT_WORDS = 100;

function pitchWordError(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 1) return "jot a one-line summary first";
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  if (words > MAX_PITCH_WORDS) return `keep it to ${MAX_PITCH_WORDS} words (currently ${words})`;
  return null;
}

function commentWordError(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 1) return "write a comment first";
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  if (words > MAX_COMMENT_WORDS) return `keep it to ${MAX_COMMENT_WORDS} words (currently ${words})`;
  return null;
}

// Concept Pitch Collab portal, opened by the server at minute 40 (same
// pattern as PeerReview.tsx's portal). Unlike Writing Clinic, the pitch
// itself is delivered out loud, so there's no highlighting tool here — the
// submitted "pitch" is just a short written summary to follow along with,
// and the only feedback mechanism is the optional comment box.
export function ConceptPitch({
  pitchOpenedAt,
  myPitchSubmitted,
  assignment,
  onSubmitPitch,
  onSubmitPitchComment,
}: {
  pitchOpenedAt: number | null;
  myPitchSubmitted: boolean;
  assignment: { pitcherId: number; pitcherUsername: string; text: string } | null;
  onSubmitPitch: (text: string) => void;
  onSubmitPitchComment: (pitcherId: number, body: string) => void;
}) {
  const [pitchInput, setPitchInput] = useState("");
  const [pitchError, setPitchError] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentSent, setCommentSent] = useState(false);

  // A fresh assignment (new cycle, new rotation) means any comment state
  // from the previous pitcher no longer applies.
  useEffect(() => {
    setCommentInput("");
    setCommentError(null);
    setCommentSent(false);
  }, [assignment?.pitcherId]);

  if (!pitchOpenedAt) return null;

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    const wordErr = pitchWordError(pitchInput);
    if (wordErr) {
      setPitchError(wordErr);
      return;
    }
    onSubmitPitch(pitchInput.trim());
    setPitchError(null);
  }

  function handleSubmitComment(e: React.FormEvent): void {
    e.preventDefault();
    if (!assignment) return;
    const wordErr = commentWordError(commentInput);
    if (wordErr) {
      setCommentError(wordErr);
      return;
    }
    onSubmitPitchComment(assignment.pitcherId, commentInput.trim());
    setCommentError(null);
    setCommentSent(true);
  }

  return (
    <div className="rounded-xl border border-sage/30 bg-white/5 p-4 text-white">
      <h2 className="font-mono text-xs uppercase tracking-widest text-sage">Concept pitch</h2>

      {!myPitchSubmitted && (
        <form onSubmit={handleSubmit} className="mt-2 space-y-2">
          <p className="text-xs opacity-70">
            Jot a short summary of your pitch (up to {MAX_PITCH_WORDS} words) so a table-mate can follow along while you
            explain it out loud.
          </p>
          <textarea
            value={pitchInput}
            onChange={(e) => {
              setPitchInput(e.target.value);
              setPitchError(null);
            }}
            placeholder="One-line summary of your concept&hellip;"
            className="h-20 w-full resize-none rounded-md border border-white/15 bg-transparent p-3 font-mono text-sm text-white outline-none focus:border-sage/50"
          />
          {pitchError && <p className="text-xs text-amber">{pitchError}</p>}
          <button type="submit" className="rounded-md bg-sage px-4 py-2 text-sm font-medium text-espresso">
            Submit pitch
          </button>
        </form>
      )}

      {myPitchSubmitted && !assignment && (
        <p className="mt-2 text-sm opacity-70">Pitch submitted — waiting for a table-mate's pitch to follow.</p>
      )}

      {assignment && (
        <div className="mt-3">
          <p className="text-xs opacity-70">Listening to {assignment.pitcherUsername}&rsquo;s pitch.</p>
          <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-white/15 p-3 font-mono text-sm">
            {assignment.text}
          </div>

          <form onSubmit={handleSubmitComment} className="mt-3 space-y-2">
            <textarea
              value={commentInput}
              onChange={(e) => {
                setCommentInput(e.target.value);
                setCommentError(null);
                setCommentSent(false);
              }}
              placeholder={`Optional: leave a short comment (≤${MAX_COMMENT_WORDS} words)`}
              className="h-20 w-full resize-none rounded-md border border-white/15 bg-transparent p-3 font-mono text-sm text-white outline-none focus:border-sage/50"
            />
            {commentError && <p className="text-xs text-amber">{commentError}</p>}
            {commentSent && !commentError && <p className="text-xs opacity-60">Comment sent.</p>}
            <button type="submit" className="rounded-md border border-white/15 px-4 py-2 text-xs font-medium opacity-80">
              Send comment
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
