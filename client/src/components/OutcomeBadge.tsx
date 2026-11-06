import type { TicketStamp } from "../types";
import { Badge } from "./Badge";

export function OutcomeBadge({ stamp, stayedFullBlock }: { stamp: TicketStamp | null; stayedFullBlock: boolean }) {
  if (stamp === "completed" && stayedFullBlock) return <Badge tone="sage">Completed</Badge>;
  if (stamp === "partial") return <Badge tone="amber">Partial</Badge>;
  if (stamp === "pivoted" && stayedFullBlock) return <Badge tone="violet">Pivoted</Badge>;
  if (stamp === null && stayedFullBlock) return <Badge tone="neutral">Not completed</Badge>;
  return <Badge tone="rose">Left early</Badge>;
}
