import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { adoptSession } from "../api";
import type {
  ActivityMode,
  CheckinRequestPayload,
  PeerReviewAssignmentPayload,
  PeerReviewHighlightKind,
  PeerReviewHighlightsPayload,
  PitchAssignmentPayload,
  PseudonymSetPayload,
  RoomError,
  RoomJoinedPayload,
  RoomUpdatePayload,
  WhiteboardCursorEvent,
} from "../types";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

// Keyed by userId. Kept as a separate state object from `room` deliberately
// (Decision 13) — cursor updates can arrive many times a second and must not
// re-render the whole table dashboard on every mouse pixel, only whatever
// actually reads `cursors`.
export type CursorMap = Record<number, WhiteboardCursorEvent & { updatedAt: number }>;

export interface TableSocketState {
  status: ConnectionStatus;
  joined: RoomJoinedPayload | null;
  room: RoomUpdatePayload | null;
  error: RoomError | null;
  isShadow: boolean;
  cursors: CursorMap;
  pendingCheckIn: CheckinRequestPayload | null;
  peerReviewAssignment: PeerReviewAssignmentPayload | null;
  myPeerReviewHighlights: PeerReviewHighlightsPayload["highlights"];
  myDraftSubmitted: boolean;
  pitchAssignment: PitchAssignmentPayload | null;
  myPitchSubmitted: boolean;
  submitTicket: (body: string, personalDurationMinutes?: number) => void;
  pivotTicket: (body: string) => void;
  toggleStuck: () => void;
  stampTicket: (stamp: "completed" | "partial" | "pivoted") => Promise<void>;
  sendKudos: (toUserId: number, emoji: string) => void;
  setPseudonym: (pseudonym: string) => void;
  whiteboardPaste: (text: string) => void;
  whiteboardHighlight: (start: number, end: number) => void;
  whiteboardCursor: (x: number, y: number) => void;
  submitDraft: (text: string) => void;
  peerHighlight: (authorId: number, start: number, end: number, kind: PeerReviewHighlightKind) => void;
  submitReviewComment: (authorId: number, body: string) => void;
  submitPitch: (text: string) => void;
  submitPitchComment: (pitcherId: number, body: string) => void;
  submitTicketComment: (toUserId: number, body: string) => void;
  confirmCheckIn: () => void;
  reconnect: () => void;
  leave: () => void;
}

let sharedSocket: Socket | null = null;

function getSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io({ transports: ["websocket", "polling"] });
  }
  return sharedSocket;
}

// The server reads identity from the `sid` cookie exactly once, at socket
// handshake time (io.use in server.ts) — it never re-reads it mid-connection.
// Login/register/guest-continue/logout all change that cookie via a plain
// REST call with no socket involved, so an already-open socket's server-side
// identity goes stale the moment one of those succeeds. Forcing a full
// disconnect+connect makes a fresh handshake run, which re-reads the cookie.
// (set_pseudonym is the one identity change that doesn't need this: its
// handler mutates `socket.data.user` on the live socket directly.)
export function reconnectSocket(): void {
  const socket = getSocket();
  if (socket.connected) socket.disconnect();
  socket.connect();
}

export function useTableSocket(
  slug: string | undefined,
  mode: ActivityMode | undefined,
  onIdentityChange?: () => void,
): TableSocketState {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [joined, setJoined] = useState<RoomJoinedPayload | null>(null);
  const [room, setRoom] = useState<RoomUpdatePayload | null>(null);
  const [error, setError] = useState<RoomError | null>(null);
  const [isShadow, setIsShadow] = useState(false);
  const [cursors, setCursors] = useState<CursorMap>({});
  const [pendingCheckIn, setPendingCheckIn] = useState<CheckinRequestPayload | null>(null);
  const [peerReviewAssignment, setPeerReviewAssignment] = useState<PeerReviewAssignmentPayload | null>(null);
  const [myPeerReviewHighlights, setMyPeerReviewHighlights] = useState<PeerReviewHighlightsPayload["highlights"]>([]);
  // Draft submission has no dedicated ack event — arrival of the targeted
  // room:peer-review-highlights event IS the signal (server only emits it to
  // sockets whose user already has a draft on file; see broadcastPeerReviewState).
  const [myDraftSubmitted, setMyDraftSubmitted] = useState(false);
  const [pitchAssignment, setPitchAssignment] = useState<PitchAssignmentPayload | null>(null);
  const [myPitchSubmitted, setMyPitchSubmitted] = useState(false);
  const cycleStartAtRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!slug || !mode) return;
    const socket = getSocket();
    setJoined(null);
    setRoom(null);
    setError(null);
    setCursors({});
    setPendingCheckIn(null);
    setPeerReviewAssignment(null);
    setMyPeerReviewHighlights([]);
    setMyDraftSubmitted(false);
    setPitchAssignment(null);
    setMyPitchSubmitted(false);
    cycleStartAtRef.current = undefined;

    function join(): void {
      socket.emit("room:join", { slug, mode });
    }

    function onConnect(): void {
      setStatus("connected");
      join();
    }
    function onDisconnect(): void {
      setStatus("disconnected");
    }
    function onJoined(payload: RoomJoinedPayload): void {
      setIsShadow(payload.isShadow);
      setJoined(payload);
      setError(null);
    }
    function onUpdate(payload: RoomUpdatePayload): void {
      // Peer Review's in-memory server state is wiped every new focus cycle
      // (src/rooms.ts's beginScheduledFocus) — mirror that here so a stale
      // "draft submitted" flag or assignment from last cycle doesn't linger.
      if (cycleStartAtRef.current !== payload.cycleStartAt) {
        cycleStartAtRef.current = payload.cycleStartAt;
        setMyDraftSubmitted(false);
        setPeerReviewAssignment(null);
        setMyPeerReviewHighlights([]);
        setPitchAssignment(null);
        setMyPitchSubmitted(false);
      }
      setRoom(payload);
    }
    function onError(payload: RoomError): void {
      setError(payload);
    }
    function onPseudonymSet(payload: PseudonymSetPayload): void {
      adoptSession(payload.token).then(() => {
        setIsShadow(false);
        onIdentityChange?.();
        join();
      });
    }
    // Kept out of `room` entirely (see CursorMap) so a mouse-move doesn't
    // trigger a re-render of anything but the whiteboard cursor layer.
    function onCursor(payload: WhiteboardCursorEvent): void {
      setCursors((prev) => ({ ...prev, [payload.userId]: { ...payload, updatedAt: Date.now() } }));
    }
    // Targeted at this socket only — see src/rooms.ts's requestCheckin.
    function onCheckinRequest(payload: CheckinRequestPayload): void {
      setPendingCheckIn(payload);
    }
    // Targeted at this socket only — see src/rooms.ts's broadcastPeerReviewState.
    function onPeerReviewAssignment(payload: PeerReviewAssignmentPayload): void {
      setPeerReviewAssignment(payload);
    }
    function onPeerReviewHighlights(payload: PeerReviewHighlightsPayload): void {
      setMyDraftSubmitted(true);
      setMyPeerReviewHighlights(payload.highlights);
    }
    // Targeted at this socket only — see src/rooms.ts's broadcastPitchState.
    function onPitchAssignment(payload: PitchAssignmentPayload): void {
      setPitchAssignment(payload);
    }
    function onPitchSubmitted(): void {
      setMyPitchSubmitted(true);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:joined", onJoined);
    socket.on("room:update", onUpdate);
    socket.on("room:error", onError);
    socket.on("pseudonym:set", onPseudonymSet);
    socket.on("whiteboard:cursor", onCursor);
    socket.on("room:checkin-request", onCheckinRequest);
    socket.on("room:peer-review-assignment", onPeerReviewAssignment);
    socket.on("room:peer-review-highlights", onPeerReviewHighlights);
    socket.on("room:pitch-assignment", onPitchAssignment);
    socket.on("room:pitch-submitted", onPitchSubmitted);

    if (socket.connected) onConnect();
    else setStatus("connecting");

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:joined", onJoined);
      socket.off("room:update", onUpdate);
      socket.off("room:error", onError);
      socket.off("pseudonym:set", onPseudonymSet);
      socket.off("whiteboard:cursor", onCursor);
      socket.off("room:checkin-request", onCheckinRequest);
      socket.off("room:peer-review-assignment", onPeerReviewAssignment);
      socket.off("room:peer-review-highlights", onPeerReviewHighlights);
      socket.off("room:pitch-assignment", onPitchAssignment);
      socket.off("room:pitch-submitted", onPitchSubmitted);
    };
  }, [slug, mode]);

  return {
    status,
    joined,
    room,
    error,
    isShadow,
    cursors,
    pendingCheckIn,
    peerReviewAssignment,
    myPeerReviewHighlights,
    myDraftSubmitted,
    pitchAssignment,
    myPitchSubmitted,
    submitTicket: (body: string, personalDurationMinutes?: number) =>
      getSocket().emit("room:submit-ticket", { body, personalDurationMinutes }),
    pivotTicket: (body: string) => getSocket().emit("room:pivot-ticket", { body }),
    toggleStuck: () => getSocket().emit("room:toggle-stuck"),
    stampTicket: (stamp) => new Promise<void>((resolve) => getSocket().emit("room:stamp-ticket", { stamp }, resolve)),
    sendKudos: (toUserId, emoji) => getSocket().emit("room:send-kudos", { toUserId, emoji }),
    setPseudonym: (pseudonym: string) => getSocket().emit("set_pseudonym", { pseudonym }),
    whiteboardPaste: (text: string) => getSocket().emit("room:whiteboard-paste", { text }),
    whiteboardHighlight: (start: number, end: number) => getSocket().emit("room:whiteboard-highlight", { start, end }),
    whiteboardCursor: (x: number, y: number) => getSocket().emit("room:whiteboard-cursor", { x, y }),
    submitDraft: (text: string) => getSocket().emit("room:submit-draft", { text }),
    peerHighlight: (authorId: number, start: number, end: number, kind: PeerReviewHighlightKind) =>
      getSocket().emit("room:peer-highlight", { authorId, start, end, kind }),
    submitReviewComment: (authorId: number, body: string) =>
      getSocket().emit("room:submit-review-comment", { authorId, body }),
    submitPitch: (text: string) => getSocket().emit("room:submit-pitch", { text }),
    submitPitchComment: (pitcherId: number, body: string) =>
      getSocket().emit("room:submit-pitch-comment", { pitcherId, body }),
    submitTicketComment: (toUserId: number, body: string) =>
      getSocket().emit("room:submit-ticket-comment", { toUserId, body }),
    confirmCheckIn: () => {
      setPendingCheckIn(null);
      getSocket().emit("room:checkin-confirm");
    },
    reconnect: () => {
      if (!slug || !mode) return;
      setError(null);
      const socket = getSocket();
      if (socket.connected) socket.emit("room:join", { slug, mode });
      else socket.connect();
    },
    leave: () => getSocket().emit("room:leave"),
  };
}

export function useLobbySocket(): import("../types").LobbyLocation[] | null {
  const [locations, setLocations] = useState<import("../types").LobbyLocation[] | null>(null);

  useEffect(() => {
    const socket = getSocket();
    function onUpdate(payload: import("../types").LobbyLocation[]): void {
      setLocations(payload);
    }
    function requestSnapshot(): void {
      socket.emit("lobby:join");
    }
    socket.on("lobby:update", onUpdate);
    // "connect" covers a fresh/dropped-then-restored connection; the shared
    // socket (getSocket()'s module-level singleton) usually already satisfies
    // `socket.connected` on remount after SPA navigation, so that case needs
    // its own explicit request — otherwise this page shows whatever the
    // socket last saw until some unrelated user action happens to broadcast.
    socket.on("connect", requestSnapshot);
    if (!socket.connected) socket.connect();
    else requestSnapshot();
    return () => {
      socket.off("lobby:update", onUpdate);
      socket.off("connect", requestSnapshot);
    };
  }, []);

  return locations;
}
