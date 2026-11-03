import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { adoptSession } from "../api";
import type {
  ActivityMode,
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
  submitTicket: (body: string) => void;
  toggleStuck: () => void;
  stampTicket: (stamp: "completed" | "partial") => void;
  sendKudos: (toUserId: number, emoji: string) => void;
  setPseudonym: (pseudonym: string) => void;
  castVote: (vote: "yes" | "no") => void;
  launchWhiteboard: () => void;
  initiateVote: () => void;
  whiteboardPaste: (text: string) => void;
  whiteboardHighlight: (start: number, end: number) => void;
  whiteboardCursor: (x: number, y: number) => void;
  reconnect: () => void;
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

export function useTableSocket(slug: string | undefined, mode: ActivityMode | undefined): TableSocketState {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [joined, setJoined] = useState<RoomJoinedPayload | null>(null);
  const [room, setRoom] = useState<RoomUpdatePayload | null>(null);
  const [error, setError] = useState<RoomError | null>(null);
  const [isShadow, setIsShadow] = useState(false);
  const [cursors, setCursors] = useState<CursorMap>({});

  useEffect(() => {
    if (!slug || !mode) return;
    const socket = getSocket();
    setJoined(null);
    setRoom(null);
    setError(null);
    setCursors({});

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
      setRoom(payload);
    }
    function onError(payload: RoomError): void {
      setError(payload);
    }
    function onPseudonymSet(payload: PseudonymSetPayload): void {
      adoptSession(payload.token).then(() => {
        setIsShadow(false);
        join();
      });
    }
    // Kept out of `room` entirely (see CursorMap) so a mouse-move doesn't
    // trigger a re-render of anything but the whiteboard cursor layer.
    function onCursor(payload: WhiteboardCursorEvent): void {
      setCursors((prev) => ({ ...prev, [payload.userId]: { ...payload, updatedAt: Date.now() } }));
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:joined", onJoined);
    socket.on("room:update", onUpdate);
    socket.on("room:error", onError);
    socket.on("pseudonym:set", onPseudonymSet);
    socket.on("whiteboard:cursor", onCursor);

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
    };
  }, [slug, mode]);

  useEffect(() => {
    const socket = getSocket();
    function onVisibilityChange(): void {
      socket.emit(document.hidden ? "tab_hidden" : "tab_visible");
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return {
    status,
    joined,
    room,
    error,
    isShadow,
    cursors,
    submitTicket: (body: string) => getSocket().emit("room:submit-ticket", { body }),
    toggleStuck: () => getSocket().emit("room:toggle-stuck"),
    stampTicket: (stamp) => getSocket().emit("room:stamp-ticket", { stamp }),
    sendKudos: (toUserId, emoji) => getSocket().emit("room:send-kudos", { toUserId, emoji }),
    setPseudonym: (pseudonym: string) => getSocket().emit("set_pseudonym", { pseudonym }),
    castVote: (vote) => getSocket().emit("room:cast-vote", { vote }),
    launchWhiteboard: () => getSocket().emit("room:launch-whiteboard"),
    initiateVote: () => getSocket().emit("room:initiate-vote"),
    whiteboardPaste: (text: string) => getSocket().emit("room:whiteboard-paste", { text }),
    whiteboardHighlight: (start: number, end: number) => getSocket().emit("room:whiteboard-highlight", { start, end }),
    whiteboardCursor: (x: number, y: number) => getSocket().emit("room:whiteboard-cursor", { x, y }),
    reconnect: () => {
      if (!slug || !mode) return;
      setError(null);
      const socket = getSocket();
      if (socket.connected) socket.emit("room:join", { slug, mode });
      else socket.connect();
    },
  };
}

export function useLobbySocket(): import("../types").LobbyLocation[] | null {
  const [locations, setLocations] = useState<import("../types").LobbyLocation[] | null>(null);

  useEffect(() => {
    const socket = getSocket();
    function onUpdate(payload: import("../types").LobbyLocation[]): void {
      setLocations(payload);
    }
    socket.on("lobby:update", onUpdate);
    if (!socket.connected) socket.connect();
    return () => {
      socket.off("lobby:update", onUpdate);
    };
  }, []);

  return locations;
}
