// Mirrors src/rooms.ts's ticketBodyError exactly, for instant client-side
// feedback before the round trip confirms it server-side.
const MAX_TICKET_LEN = 60;
const VAGUE_TICKETS = new Set(["study", "work", "homework", "stuff", "things", "read", "reading"]);

export function ticketBodyError(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_TICKET_LEN) return "1-60 characters";
  const nonSpace = trimmed.replace(/\s/g, "");
  if (nonSpace.length < 3) return "needs more detail";
  if (VAGUE_TICKETS.has(trimmed.toLowerCase())) return "be specific — what will you actually do?";
  return null;
}
