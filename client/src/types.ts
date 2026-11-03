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

export type TicketStamp = "completed" | "partial";

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
  vote: "yes" | "no" | null;
  stayedFullBlock: boolean;
  createdAt: number;
}

export interface TicketWithKudos extends Ticket {
  kudos: Kudos[];
}

export interface RosterEntry {
  userId: number;
  username: string;
  isGuest: boolean;
  tabHidden: boolean;
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
  voteOpenedAt: number | null;
  capacity: number;
  upcoming: ScheduledSession[];
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

export const KUDOS_EMOJI = ["⚡", "☕", "🧠"] as const;

export function isGuestId(id: number): boolean {
  return id < 0;
}
