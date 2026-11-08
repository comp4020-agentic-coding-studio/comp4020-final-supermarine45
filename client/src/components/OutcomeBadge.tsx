import type { TicketStamp } from "../types";
import { Badge } from "./Badge";

export function OutcomeBadge({ stamp, stayedFullBlock }: { stamp: TicketStamp | null; stayedFullBlock: boolean }) {
  // A ticket's stamp reflects what the user actually did with it and is
  // independent of stayedFullBlock (which only governs VFH eligibility, e.g.
  // a missed-check-in demotion) — a demoted-but-stamped ticket is still a
  // real Completed/Partial/Pivoted outcome, not a "Left early" one. Only an
  // unstamped ticket falls back to stayedFullBlock to distinguish "left
  // early" from "stuck around but never checked a box."
  if (stamp === "completed") return <Badge tone="sage">Completed</Badge>;
  if (stamp === "partial") return <Badge tone="amber">Partial</Badge>;
  if (stamp === "pivoted") return <Badge tone="violet">Pivoted</Badge>;
  if (stayedFullBlock) return <Badge tone="neutral">Not completed</Badge>;
  return <Badge tone="rose">Left early</Badge>;
}
