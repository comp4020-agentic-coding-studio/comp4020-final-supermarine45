import { useEffect, useRef, useState } from "react";
import type { RoomUpdatePayload } from "../types";

export interface KudosToast {
  id: string;
  emoji: string;
  fromUsername: string;
}

// Long enough to read a short line, well short of anything that could read
// as a persistent banner (Calm Technology — see CLAUDE.md).
const TOAST_LIFETIME_MS = 4000;

// Always-visible in-app pop-up for receiving a Kudos, independent of the
// browser Notification permission that usePhaseNotifications' OS alert
// depends on (many users never grant that). Diffs by kudos id rather than
// array length so two Kudos landing in the same broadcast each get their own
// toast instead of collapsing into one.
export function useKudosToasts(room: RoomUpdatePayload | null, myUserId: number | undefined): KudosToast[] {
  const [toasts, setToasts] = useState<KudosToast[]>([]);
  const seenKudosIdsRef = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (!room || myUserId === undefined) return;
    const myTicket = room.tickets.find((t) => t.userId === myUserId);
    if (!myTicket) {
      // No ticket boarded this cycle (yet) — reseed fresh once one appears,
      // same guard as usePhaseNotifications' prevKudosCountRef.
      seenKudosIdsRef.current = null;
      return;
    }
    const seen = seenKudosIdsRef.current;
    if (seen === null) {
      // First sighting of this ticket (mount, reconnect, or new cycle) —
      // seed without popping toasts for Kudos already on it.
      seenKudosIdsRef.current = new Set(myTicket.kudos.map((k) => k.id));
      return;
    }
    const freshKudos = myTicket.kudos.filter((k) => !seen.has(k.id));
    if (freshKudos.length === 0) return;
    for (const k of freshKudos) seen.add(k.id);
    const newToasts = freshKudos.map((k) => {
      const from = room.roster.find((r) => r.userId === k.fromUserId);
      return { id: `${k.id}`, emoji: k.emoji, fromUsername: from?.username ?? "Someone" };
    });
    setToasts((cur) => [...cur, ...newToasts]);
  }, [room, myUserId]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => setToasts((cur) => cur.slice(1)), TOAST_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  return toasts;
}
