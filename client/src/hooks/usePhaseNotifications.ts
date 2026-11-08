import { useEffect, useRef } from "react";
import type { CheckinRequestPayload, RoomUpdatePayload } from "../types";

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

export function usePhaseNotifications(
  room: RoomUpdatePayload | null,
  myUserId: number | undefined,
  chimeEnabled: boolean,
  now: number,
  pendingCheckIn?: CheckinRequestPayload | null,
): void {
  const prevStatusRef = useRef<string | undefined>(undefined);
  const prevSubphaseRef = useRef<string | null | undefined>(undefined);
  const prevWhiteboardOpenedAtRef = useRef<number | null | undefined>(undefined);
  const prevPeerReviewOpenedAtRef = useRef<number | null | undefined>(undefined);
  const prevKudosCountRef = useRef<number | undefined>(undefined);
  // A check-in request is only visible in-tab (CheckInModal) otherwise —
  // someone legitimately working in another tab/app (exactly who this app
  // is for) would never see it, miss the grace window, and get silently
  // demoted. Fires once per deadline so backgrounding the tab still pages
  // the user via the OS, same as every other notify() call here.
  const notifiedCheckinDeadlineRef = useRef<number | undefined>(undefined);
  // Fires once per personal-duration ticket (keyed by ticket id) — a shorter
  // personal block chosen at board time, see TicketForm's duration preset.
  // Purely an attention cue: doesn't pause, stamp, or remove the ticket, and
  // never touches the shared table timer other members see.
  const personalNudgedTicketIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!room) return;

    const prevStatus = prevStatusRef.current;
    const prevSubphase = prevSubphaseRef.current;
    if ((prevStatus !== undefined && prevStatus !== room.timer.status) || (prevSubphase !== undefined && prevSubphase !== room.timer.subphase)) {
      if (chimeEnabled) playChime();
    }
    // Concept Pitch has no shared artifact to open (unlike Whiteboard/Peer
    // Review), so the subphase flip itself is the only Collab-start signal —
    // fire the same notification shape directly off it.
    if (room.mode === "pitch" && prevSubphase === "solo" && room.timer.subphase === "collab") {
      notify("🟢 Collab Phase Unlocked", "Time to explain your concept out loud to the table.");
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

    const prevPeerReviewOpenedAt = prevPeerReviewOpenedAtRef.current;
    if (prevPeerReviewOpenedAt !== undefined && prevPeerReviewOpenedAt === null && room.peerReviewOpenedAt !== null) {
      notify("🟢 Collab Phase Unlocked", "Peer Review is open — paste your draft to get a table-mate's feedback.");
    }
    prevPeerReviewOpenedAtRef.current = room.peerReviewOpenedAt;

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

  useEffect(() => {
    if (!room || myUserId === undefined || room.timer.status !== "focus") return;
    const myTicket = room.tickets.find((t) => t.userId === myUserId);
    if (!myTicket || myTicket.personalDurationMs == null) return;
    if (personalNudgedTicketIdRef.current === myTicket.id) return;
    if (now < myTicket.cycleStartAt + myTicket.personalDurationMs) return;
    personalNudgedTicketIdRef.current = myTicket.id;
    if (chimeEnabled) playChime();
    notify("⏱️ Personal block done", `Your ${Math.round(myTicket.personalDurationMs / 60_000)}m block is up — the table keeps going.`);
  }, [room, myUserId, chimeEnabled, now]);

  useEffect(() => {
    if (!pendingCheckIn) return;
    if (notifiedCheckinDeadlineRef.current === pendingCheckIn.deadlineAt) return;
    notifiedCheckinDeadlineRef.current = pendingCheckIn.deadlineAt;
    if (chimeEnabled) playChime();
    notify("👀 Still here?", "Click to confirm you're still focused, or you'll be moved back to Shadow.");
  }, [pendingCheckIn, chimeEnabled]);
}
