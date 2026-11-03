import { useState } from "react";
import { ticketBodyError } from "../validation";

export function TicketForm({
  initialValue,
  onSubmit,
  disabled,
  dark,
}: {
  initialValue: string;
  onSubmit: (body: string) => void;
  disabled: boolean;
  // Set by callers rendering this on a dark backdrop (TablePage during the
  // OLED-black focus phase, BreakModal's espresso re-board card) — the label/
  // error/button otherwise use charcoal-on-transparent, which disappears
  // against those backgrounds. The input itself stays a white "paper" box
  // regardless of theme, so it never needs this.
  dark?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const problem = value.trim().length > 0 ? ticketBodyError(value) : null;

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (problem || !value.trim()) return;
    onSubmit(value.trim());
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor="ticket-body" className={`text-sm font-medium ${dark ? "text-cream" : "text-charcoal"}`}>
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
          className="w-full bg-transparent font-mono text-sm outline-none disabled:opacity-50"
        />
        <span className="shrink-0 font-mono text-xs text-slate">{value.length}/60</span>
      </div>
      {problem && <p className={`text-xs ${dark ? "text-amber-400" : "text-amber-700"}`}>{problem}</p>}
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
