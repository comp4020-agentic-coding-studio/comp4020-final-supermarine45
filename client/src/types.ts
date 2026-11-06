export type ActivityMode = "silent" | "writing" | "pitch" | "problem";

export const ACTIVITY_MODES: ActivityMode[] = ["silent", "writing", "pitch", "problem"];

export interface ActivityModeInfo {
  mode: ActivityMode;
  label: string;
  description: string;
  splitMinutes: number | null;
}

export type RoomStatus = "idle" | "focus" | "break";
export type Subphase = "solo" | "collab" | null;

export type TicketStamp = "completed" | "partial" | "pivoted";

export interface Kudos {
  id: number;
  ticketId: number;
  fromUserId: number;
  emoji: string;
  createdAt: number;
}

export interface Ticket {
  id: number;
  locationId: number;
  activityMode: ActivityMode;
  userId: number;
  username: string;
  cycleStartAt: number;
  body: string;
  stuck: boolean;
  stuckAt: number | null;
  stamp: TicketStamp | null;
  stayedFullBlock: boolean;
  pivotedAt: number | null;
  // Null means the full shared table block (the default). A shorter personal
  // block chosen at board time — see TicketForm's duration preset — never
  // changes the table-wide timer every other member sees.
  personalDurationMs: number | null;
  createdAt: number;
}

export interface TicketWithKudos extends Ticket {
  kudos: Kudos[];
}

export interface RosterEntry {
  userId: number;
  username: string;
  isGuest: boolean;
  checkinPending: boolean;
}

export interface TimerPayload {
  status: RoomStatus;
  phaseEndAt: number | null;
  durationMs: number | null;
  subphase: Subphase;
}

export interface ScheduledSession {
  id: number;
  locationId: number;
  username: string;
  startsAt: number;
}

export interface WhiteboardHighlight {
  start: number;
  end: number;
  byUserId: number;
}

export type PeerReviewHighlightKind = "strong" | "confusing" | "citation";

export interface PeerReviewHighlight {
  start: number;
  end: number;
  kind: PeerReviewHighlightKind;
  byUserId: number;
}

export interface RoomUpdatePayload {
  mode: ActivityMode;
  timer: TimerPayload;
  cycleStartAt: number;
  roster: RosterEntry[];
  shadowCount: number;
  tickets: TicketWithKudos[];
  leaderUserId: number | null;
  whiteboardOpenedAt: number | null;
  whiteboardText: string;
  whiteboardHighlights: WhiteboardHighlight[];
  peerReviewOpenedAt: number | null;
  capacity: number;
  upcoming: ScheduledSession[];
}

// Targeted (per-socket), not part of RoomUpdatePayload — same reasoning as
// CheckinRequestPayload: only the reviewer assigned to this author's draft
// needs to see it, and only the author needs to see highlights landing on
// their own text. Sent on submit-draft, on every new highlight, and on
// (re)join once the portal is already open — see rooms.ts's
// broadcastPeerReviewState.
export interface PeerReviewAssignmentPayload {
  authorId: number;
  authorUsername: string;
  text: string;
  highlights: PeerReviewHighlight[];
}

export interface PeerReviewHighlightsPayload {
  highlights: PeerReviewHighlight[];
}

// Separate from RoomUpdatePayload deliberately: live cursors are a
// continuous, unthrottled-server-side broadcast, not part of the
// discrete-state-change room:update contract.
export interface WhiteboardCursorEvent {
  userId: number;
  x: number;
  y: number;
}

export interface RoomJoinedPayload {
  location: { slug: string; name: string };
  mode: ActivityMode;
  modeInfo: ActivityModeInfo;
  myTicket: Ticket | null;
  isShadow: boolean;
}

export interface RoomError {
  error: string;
  action: string;
}

// Sent directly to one socket (not part of RoomUpdatePayload — check-in state
// is per-user, not shared table state): a micro check-in ping that must be
// confirmed by deadlineAt or the server demotes this user back to Shadow.
export interface CheckinRequestPayload {
  deadlineAt: number;
}

export interface Identity {
  id: number;
  username: string;
}

export interface PseudonymSetPayload {
  token: string;
  identity: Identity;
}

export interface LobbyModeSummary {
  mode: ActivityMode;
  status: RoomStatus;
  occupants: number;
  ticketCount: number;
  timer: TimerPayload;
  roster: RosterEntry[];
  shadowCount: number;
}

export interface LobbyLocation {
  slug: string;
  name: string;
  buildingSlug: string;
  buildingName: string;
  occupants: number;
  shadowCount: number;
  modes: LobbyModeSummary[];
  upcomingCount: number;
}

export interface Me {
  id: number;
  username: string;
  vfhCount: number | null;
  isGuest: boolean;
  email?: string;
  chimeEnabled?: boolean;
}

export interface HeatmapEntry {
  date: string;
  count: number;
}

export interface CognitiveDietEntry {
  mode: ActivityMode;
  count: number;
}

export interface HubStatsEntry {
  locationName: string;
  count: number;
}

export interface StreakEntry {
  locationName: string;
  activityMode: ActivityMode;
  currentStreak: number;
  longestStreak: number;
}

export type BuddyStatus = "pending" | "accepted";

export interface Buddy {
  id: number;
  requesterId: number;
  addresseeId: number;
  status: BuddyStatus;
  createdAt: number;
}

export interface BuddyFeedEntry {
  ticketId: number;
  username: string;
  locationName: string;
  activityMode: ActivityMode;
  body: string;
  stamp: TicketStamp | null;
  cycleStartAt: number;
}

export interface UpcomingSessionForUser {
  id: number;
  locationSlug: string;
  locationName: string;
  startsAt: number;
}

export interface UserHistoryEntry {
  ticketId: number;
  locationSlug: string;
  locationName: string;
  activityMode: ActivityMode;
  body: string;
  stamp: TicketStamp | null;
  stayedFullBlock: boolean;
  cycleStartAt: number;
}

export interface LocationHistoryEntry {
  ticketId: number;
  username: string;
  activityMode: ActivityMode;
  body: string;
  stamp: TicketStamp | null;
  stayedFullBlock: boolean;
  cycleStartAt: number;
}

export interface LocationStats {
  vfhThisWeek: number;
  lastActiveRollovers: number;
}

export const KUDOS_EMOJI = ["⚡", "☕", "🧠"] as const;

export function isGuestId(id: number): boolean {
  return id < 0;
}
