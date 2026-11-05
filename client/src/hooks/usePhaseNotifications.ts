import { useEffect, useRef } from "react";
import type { RoomUpdatePayload } from "../types";

// Foreground-only (Notification API from an open-but-backgrounded tab) — no
// Service Worker, no push subscriptions. Chimes are muted unless the caller
// passes chimeEnabled=true (opt-in, see AccountPage's toggle).
function playChime(): void {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch {
    // Web Audio unavailable — silently skip the chime, nothing to recover.
  }
}

function notify(title: string, body: string): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body });
  } catch {
    // Construction can throw on some platforms (e.g. no notification center) — skip.
  }
}

export function usePhaseNotifications(room: RoomUpdatePayload | null, myUserId: number | undefined, chimeEnabled: boolean): void {
  const prevStatusRef = useRef<string | undefined>(undefined);
  const prevSubphaseRef = useRef<string | null | undefined>(undefined);
  const prevWhiteboardOpenedAtRef = useRef<number | null | undefined>(undefined);
  const prevKudosCountRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!room) return;

    const prevStatus = prevStatusRef.current;
    const prevSubphase = prevSubphaseRef.current;
    if ((prevStatus !== undefined && prevStatus !== room.timer.status) || (prevSubphase !== undefined && prevSubphase !== room.timer.subphase)) {
      if (chimeEnabled) playChime();
    }
    prevStatusRef.current = room.timer.status;
    prevSubphaseRef.current = room.timer.subphase;

    const prevWhiteboardOpenedAt = prevWhiteboardOpenedAtRef.current;
    if (prevWhiteboardOpenedAt !== undefined && prevWhiteboardOpenedAt === null && room.whiteboardOpenedAt !== null) {
      const leader = room.roster.find((r) => r.userId === room.leaderUserId);
      notify(
        "🟢 Collab Phase Unlocked",
        `${leader?.username ?? "The pod leader"} (Pod Leader) has opened the Whiteboard. Click here to join.`,
      );
    }
    prevWhiteboardOpenedAtRef.current = room.whiteboardOpenedAt;

    if (myUserId !== undefined) {
      const myTicket = room.tickets.find((t) => t.userId === myUserId);
      const kudosCount = myTicket?.kudos.length ?? 0;
      const prevKudosCount = prevKudosCountRef.current;
      if (prevKudosCount !== undefined && kudosCount > prevKudosCount && myTicket) {
        const latest = myTicket.kudos[myTicket.kudos.length - 1];
        const from = room.roster.find((r) => r.userId === latest.fromUserId);
        notify("⚡ Encouragement", `${from?.username ?? "Someone"} sent you a Kudo for your focus block!`);
      }
      prevKudosCountRef.current = kudosCount;
    }
  }, [room, myUserId, chimeEnabled]);
}
