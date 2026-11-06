import { useState } from "react";
import { ticketBodyError } from "../validation";

// Fixed presets only, no free-form duration input — per CLAUDE.md's "Simple
// Interface." 50 is the full shared table block; the shorter ones are a
// personal-only overlay (see rooms.ts's PERSONAL_DURATION_PRESETS_MIN) that
// never changes the table-wide timer every other member sees.
const DURATION_PRESETS_MIN = [25, 40, 50] as const;

export function TicketForm({
  initialValue,
  onSubmit,
  disabled,
  dark,
}: {
  initialValue: string;
  onSubmit: (body: string, personalDurationMinutes?: number) => void;
  disabled: boolean;
  // Set by callers rendering this on a dark backdrop (TablePage during the
  // OLED-black focus phase, BreakModal's espresso re-board card) — the label/
  // error/button otherwise use charcoal-on-transparent, which disappears
  // against those backgrounds. The input itself stays a white "paper" box
  // regardless of theme, so it never needs this.
  dark?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [duration, setDuration] = useState<(typeof DURATION_PRESETS_MIN)[number]>(50);
  const problem = value.trim().length > 0 ? ticketBodyError(value) : null;

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (problem || !value.trim()) return;
    onSubmit(value.trim(), duration);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {/* The label, helper text, and duration chips sit directly on the page
          chrome background (bg-canvas), which flips with the site theme —
          so they track text-ink/text-ink-muted/border-line rather than the
          `dark` prop's fixed charcoal/cream pair, which is reserved for text
          that sits on this component's own literal paper/OLED backdrops
          below (the white ticket box, and the charcoal "Board this table"
          button, which the redesign plan keeps session-palette regardless
          of theme). */}
      <label htmlFor="ticket-body" className={`text-sm font-medium ${dark ? "text-cream" : "text-ink"}`}>
        Deliverable Ticket — what will you do this block?
      </label>
      <div className="flex items-center gap-2 rounded-md border border-black/15 bg-white px-3 py-2 focus-within:border-charcoal">
        <span className="font-mono text-slate" aria-hidden="true">
          &gt;
        </span>
        <input
          id="ticket-body"
          type="text"
          value={value}
          maxLength={60}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Draft the intro to chapter 2"
          className="w-full bg-transparent font-mono text-sm text-charcoal outline-none disabled:opacity-50"
        />
        <span className="shrink-0 font-mono text-xs text-slate">{value.length}/60</span>
      </div>
      {problem && <p className={`text-xs ${dark ? "text-amber-400" : "text-amber-700"}`}>{problem}</p>}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium ${dark ? "text-cream/70" : "text-ink-muted"}`}>Block length</span>
        <div className="flex gap-1">
          {DURATION_PRESETS_MIN.map((minutes) => (
            <button
              key={minutes}
              type="button"
              disabled={disabled}
              onClick={() => setDuration(minutes)}
              aria-pressed={duration === minutes}
              className={`rounded-md px-2 py-1 font-mono text-xs transition disabled:opacity-40 ${
                duration === minutes
                  ? dark
                    ? "bg-cream text-charcoal"
                    : "bg-charcoal text-paper"
                  : dark
                    ? "border border-white/20 text-cream/70"
                    : "border border-line text-ink-muted"
              }`}
            >
              {minutes}m
            </button>
          ))}
        </div>
      </div>
      <button
        type="submit"
        disabled={disabled || !!problem || !value.trim()}
        className={`self-start rounded-md px-4 py-2 text-sm font-medium transition hover:opacity-90 disabled:opacity-40 ${
          dark ? "bg-cream text-charcoal" : "bg-charcoal text-paper"
        }`}
      >
        Board this table
      </button>
    </form>
  );
}
