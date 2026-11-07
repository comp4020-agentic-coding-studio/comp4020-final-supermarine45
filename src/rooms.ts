import type { DatabaseSync } from "node:sqlite";
import type { Server, Socket } from "socket.io";
import type { ActivityMode, Identity, Location, RoomState, RoomStatus, Ticket } from "./db.js";
import {
  ACTIVITY_MODES,
  addKudos,
  countBoardedTickets,
  countUpcomingSessions,
  deleteUserBuddies,
  deleteUserChatMessages,
  deleteUserKudosGiven,
  deleteUserRow,
  deleteUserScheduledSessions,
  deleteUserSessions,
  deleteUserStreaks,
  deleteUserTickets,
  getKudosForTicket,
  getLocationBySlug,
  getMostRecentStartedTicket,
  getOrCreateTable,
  getPreviousTicket,
  getTable,
  getTicket,
  incrementStreak,
  incrementTableRollovers,
  isGuest,
  listLocations,
  listTickets,
  listUpcomingSessions,
  markTicketNotFullBlock,
  pivotTicket,
  resetStreak,
  setTableState,
  stampTicket,
  toggleStuck,
  upsertTicket,
} from "./db.js";
import type { TicketStamp } from "./db.js";
import { createPseudonymIdentity } from "./auth.js";
import { identityLabel, logRoomAction, logSystemAction } from "./logger.js";

// The hourly cycle: a table's focus block starts only on this boundary,
// never on-demand — there is no manual "start" for anyone. Overridable so
// the spec suite can run full cycles in seconds instead of waiting out a
// real hour (same posture as every other real-timer spec in this codebase,
// e.g. persistent-stats.test.ts waiting out real 1-2.5s blocks); production
// falls back to a real hour, following server.ts's process.env.X ?? default
// convention.
export const TABLE_CYCLE_MS = Number(process.env.TABLE_CYCLE_MS) || 60 * 60 * 1000;
// Derived from TABLE_CYCLE_MS (50:10 split, the spec's 50m-work/10m-break
// ratio) rather than hardcoded absolute minutes, so overriding the cycle
// length for tests scales the whole loop coherently instead of leaving a
// real 50-minute focus phase stuck inside a test-speed cycle. Also
// guarantees FOCUS_DURATION_MS + BREAK_DURATION_MS === TABLE_CYCLE_MS
// exactly, by construction.
export const FOCUS_DURATION_MS = Math.round(TABLE_CYCLE_MS * (50 / 60));
export const BREAK_DURATION_MS = TABLE_CYCLE_MS - FOCUS_DURATION_MS;
export const TABLE_CAPACITY = 6;

// Independent granularity for when a new cycle may begin, separate from
// TABLE_CYCLE_MS (which still governs the full 60-min arc once a cycle
// starts). A table now gets a chance to start on any 5-minute wall-clock
// mark instead of waiting for the top of the hour, shrinking the worst-case
// wait from ~59 minutes to ~5 — the session's own length/shape is
// unaffected. Same process.env.X || default convention as every other
// timing constant in this file.
export const CYCLE_START_GRANULARITY_MS = Number(process.env.CYCLE_START_GRANULARITY_MS) || 5 * 60 * 1000;

// Personal shorter duration (chosen at board time, see room:submit-ticket):
// a small fixed preset, not free-form input, per CLAUDE.md's "Simple
// Interface" mandate. 50 is the full block and stores as personalDurationMs:
// null (equivalent to "no override") rather than FOCUS_DURATION_MS itself,
// so the shared table timer stays the single source of truth for the full
// block's exact length. Expressed as minutes-of-50 (scaled against
// FOCUS_DURATION_MS, like ACTIVITY_MODE_INFO.splitMinutes/splitMsFor) so a
// test-speed TABLE_CYCLE_MS shortens these proportionally too.
export const PERSONAL_DURATION_PRESETS_MIN = [25, 40, 50] as const;

const MAX_TICKET_LEN = 60;
const VAGUE_TICKETS = new Set(["study", "work", "homework", "stuff", "things", "read", "reading"]);
const KUDOS_EMOJI = new Set(["⚡", "☕", "🧠"]);
// Defensive caps on the Whiteboard — a scratch surface for pasted
// code/problem text, not an open-ended document.
const MAX_WHITEBOARD_TEXT_LEN = 2000;
const MAX_WHITEBOARD_HIGHLIGHTS = 100;

// Programmatic honesty (micro check-ins): tab visibility can no longer be
// used as an activity signal — students legitimately tab away to code, use
// Google Docs, etc. (see prompt-to-do.md) — so the server instead pings
// every live Active user twice per focus block and requires an explicit
// click-to-confirm within CHECKIN_GRACE_MS, or demotes them back to Shadow
// exactly as the old tab-hidden penalty did. See requestCheckin/
// applyCheckinPenalty. Offsets are expressed as a fraction of the block
// (40%/70% of 50 == 20/35) rather than absolute minutes, so they scale
// correctly both under a test-speed TABLE_CYCLE_MS override AND under a
// user's own Personal Shorter Duration ticket (see
// PERSONAL_DURATION_PRESETS_MIN/personalDurationMsFor) — a user who boards a
// shorter personal block still gets pinged at proportionally the same two
// points in *their own* block, not the fixed 20/35-minute marks of the full
// block (see checkinOffsetsMsFor/armCheckinTimers). CHECKIN_GRACE_MS is
// independently overridable (same process.env.X || default convention)
// since it's a fixed human-response budget, not a fraction of the cycle — a
// shortened test cycle needs this shortened too, or the grace window could
// outlast the whole test-speed focus block.
export const CHECKIN_OFFSETS_MIN = [20, 35];
const CHECKIN_OFFSET_FRACTIONS = CHECKIN_OFFSETS_MIN.map((min) => min / 50);
function checkinOffsetsMsFor(durationMs: number): number[] {
  return CHECKIN_OFFSET_FRACTIONS.map((fraction) => Math.round(durationMs * fraction));
}
// Every personal-duration preset (including the full 50m block) gets its own
// pair of fire times, deduplicated into one list of table-wide timers —
// armCheckinTimers arms one timer per entry here, and each firing filters
// recipients by whichever offsets their own *current* ticket maps to (see
// armCheckinTimers), rather than one timer set per user.
function allCheckinFireOffsetsMs(): number[] {
  const durations = PERSONAL_DURATION_PRESETS_MIN.map((min) => personalDurationMsFor(min) ?? FOCUS_DURATION_MS);
  const offsets = new Set<number>();
  for (const duration of durations) for (const offset of checkinOffsetsMsFor(duration)) offsets.add(offset);
  return [...offsets].sort((a, b) => a - b);
}
export const CHECKIN_GRACE_MS = Number(process.env.CHECKIN_GRACE_MS) || 2 * 60 * 1000;

export interface ActivityModeInfo {
  mode: ActivityMode;
  label: string;
  description: string;
  splitMinutes: number | null;
}

// Single source of truth for the 4 cognitive modes — same role
// FOCUS_PRESETS_MIN used to play for /api/config. splitMinutes is the Solo
// Gate -> Collab Phase boundary; null means no split (solo the whole block).
export const ACTIVITY_MODE_INFO: ActivityModeInfo[] = [
  { mode: "silent", label: "Silent Focus", description: "Heads-down, solo, the whole block.", splitMinutes: null },
  {
    mode: "writing",
    label: "Writing Clinic",
    description: "Solo drafting, then swap screens and give feedback.",
    splitMinutes: 40,
  },
  {
    mode: "pitch",
    label: "Concept Pitch",
    description: "Solo prep, then explain your concept out loud.",
    splitMinutes: 40,
  },
  {
    mode: "problem",
    label: "Problem-Solving",
    description: "Solo attempt, then rubber-duck the ones you're stuck on.",
    splitMinutes: 40,
  },
];

// splitMinutes is documented at the real 50-minute scale, but computed here
// as a fraction of FOCUS_DURATION_MS rather than a hardcoded *60_000 — so
// that a shortened TABLE_CYCLE_MS (test runs) scales the solo/collab split
// point along with everything else, instead of the split threshold staying
// pinned at a real-world minute count a test-speed focus block never reaches.
function splitMsFor(mode: ActivityMode): number | null {
  const minutes = ACTIVITY_MODE_INFO.find((m) => m.mode === mode)!.splitMinutes;
  return minutes === null ? null : FOCUS_DURATION_MS * (minutes / 50);
}

// Generalizes the old nextGridMark (:00/:30 lobby marks) to a full-hour
// cadence with no lobby/vote step at all — the next wall-clock boundary at
// or after `now`. No "too soon to vote" guard is needed anymore (that
// existed only to keep a lobby open long enough for humans to vote; a cycle
// mark here just checks whether anyone's already boarded, instantaneous
// either way).
export function nextCycleMark(now: number, periodMs: number = TABLE_CYCLE_MS): number {
  return Math.ceil(now / periodMs) * periodMs;
}

// 'silent' is solo for the full 50 minutes; the other three modes gate
// collaboration behind their mode-specific split point. Computed fresh on
// every broadcast during 'focus', never stored — same philosophy as this
// file's derived remainingMs.
export function computeSubphase(mode: ActivityMode, elapsedMs: number): "solo" | "collab" | null {
  const split = splitMsFor(mode);
  if (split === null) return null;
  return elapsedMs < split ? "solo" : "collab";
}

// Deterministic, never stored: the earliest-boarded ticket for the current
// cycle is the Pod Leader. Self-heals if that ticket is ever removed (e.g.
// account deletion) since this is recomputed on every broadcast, same
// philosophy as computeSubphase. Relies on listTickets' ORDER BY id ASC plus
// upsertTicket's single synchronous statement to resolve simultaneous
// boarding races deterministically, same as the existing 6-cap race.
function leaderUserId(tickets: Ticket[]): number | null {
  return tickets[0]?.userId ?? null;
}

interface Presence {
  socketId: string;
  user: Identity;
  joinedAt: number;
  // Micro check-in: the deadline (epoch ms) this user must confirm by, if a
  // ping is currently outstanding (undefined otherwise), and the pending
  // demotion timeout armed alongside it.
  checkinDeadlineAt?: number;
  penaltyTimeout: NodeJS.Timeout | null;
  demoted: boolean;
}

interface TimerPayload {
  status: RoomStatus;
  phaseEndAt: number | null;
  durationMs: number | null;
  subphase: "solo" | "collab" | null;
}

interface RosterEntry {
  userId: number;
  username: string;
  isGuest: boolean;
  checkinPending: boolean;
}

// A table is keyed by (location, mode) jointly — up to 4 independent tables
// per hub (Decision 1). All in-memory state below is keyed the same way, via
// this combined string key, rather than nested per-location maps.
function tableKey(locationId: number, mode: ActivityMode): string {
  return `${locationId}:${mode}`;
}

function roomName(locationId: number, mode: ActivityMode): string {
  return `table:${locationId}:${mode}`;
}

// tableKey -> socketId -> presence. In-memory: who's actually connected right
// now. room_state in the DB is the durable, authoritative timer state.
const presence = new Map<string, Map<string, Presence>>();
// tableKey -> the one pending setTimeout driving this table's next
// transition (idle-check, end-of-focus, or end-of-break — see the scheduler
// below). Every table always has exactly one armed, even while idle.
const scheduledTransitions = new Map<string, NodeJS.Timeout>();
// tableKey -> the one or two one-off timeouts that force a re-broadcast
// around a mode's solo->collab split point (see armSubphaseTimer). Separate
// from scheduledTransitions for the same reason checkinTimers is: these
// never change DB state, they just make the subphase flip show up live
// instead of waiting for some other event to trigger a broadcast.
const subphaseTimers = new Map<string, NodeJS.Timeout[]>();
// tableKey -> the two one-off timeouts that fire a check-in ping at
// CHECKIN_OFFSETS_MIN into a focus block. Separate from scheduledTransitions
// for the same reason subphaseTimers is: these never touch DB state, they
// just drive a per-socket request/grace cycle (see requestCheckin).
const checkinTimers = new Map<string, NodeJS.Timeout[]>();
// Shadows (no socket.data.user) never enter `presence`, so they're invisible
// to roster()/occupancy() — this tracks them separately, by socket id only
// (no identity to keep), purely so the table/lobby can show "N watching".
const shadowCounts = new Map<string, Set<string>>();

// The Breakout Whiteboard (Problem-Solving Collab only): a single shared,
// continuously-overwritten scratch surface, not a message log — no sender,
// no history, cleared at the start of every new focus cycle. In-memory only,
// same precedent as presence/shadowCounts: a 10-minute scratch surface has
// no persistence requirement, and a restart simply starts it empty again.
interface WhiteboardState {
  text: string;
  highlights: { start: number; end: number; byUserId: number }[];
  openedAt: number | null;
}
const whiteboards = new Map<string, WhiteboardState>();
// tableKey -> the fallback timer that auto-opens the Whiteboard if nobody
// clicks Launch, so a disengaged table can't block itself.
const whiteboardFallbackTimers = new Map<string, NodeJS.Timeout>();

// Peer Review (Writing Clinic Collab only): opens automatically at minute 40
// (no manual "Launch" step, unlike the Whiteboard) via armPeerReviewTimer.
// In-memory only, same precedent as whiteboards — a review round has no
// persistence requirement and starts fresh every new focus cycle.
export type PeerReviewHighlightKind = "strong" | "confusing" | "citation";
interface PeerReviewHighlight {
  start: number;
  end: number;
  kind: PeerReviewHighlightKind;
  byUserId: number;
}
interface PeerReviewDraft {
  userId: number;
  username: string;
  text: string;
}
interface PeerReviewState {
  openedAt: number | null;
  drafts: Map<number, PeerReviewDraft>; // keyed by authorId
  assignments: Map<number, number>; // reviewerUserId -> authorUserId (N-way rotation)
  highlights: Map<number, PeerReviewHighlight[]>; // keyed by authorId
}
const peerReviews = new Map<string, PeerReviewState>();
// tableKey -> the one-off timer that auto-opens the Peer Review portal at
// minute 40 — see armPeerReviewTimer.
const peerReviewTimers = new Map<string, NodeJS.Timeout>();
const MAX_DRAFT_WORDS = 200;
const MAX_PEER_REVIEW_HIGHLIGHTS = 100;

function shadowCount(locationId: number, mode: ActivityMode): number {
  return shadowCounts.get(tableKey(locationId, mode))?.size ?? 0;
}

// presence is keyed by socket.id, not userId, so the same person connected
// from two tabs (or a stray second socket) holds two entries here — merge
// them to one roster row per person, or every userId-keyed consumer
// downstream (unboardedRoster's filter, TableDashboard's .find(), and
// React's key={r.userId} in PresentRoster) sees duplicate rows that don't
// behave like duplicates: a boarded ticket clears the userId from the
// *filter*, but a keyed list that briefly held two rows under the same key
// can strand one of them in the DOM instead of removing it. checkinPending is
// OR'd across a person's connections so any one outstanding ping still raises
// the warning, matching the demotion mechanism's per-connection risk tracking.
function roster(locationId: number, mode: ActivityMode): RosterEntry[] {
  const table = presence.get(tableKey(locationId, mode));
  if (!table) return [];
  const byUser = new Map<number, RosterEntry>();
  for (const p of table.values()) {
    if (p.demoted) continue;
    const existing = byUser.get(p.user.id);
    if (existing) {
      existing.checkinPending = existing.checkinPending || p.checkinDeadlineAt !== undefined;
      continue;
    }
    byUser.set(p.user.id, {
      userId: p.user.id,
      username: p.user.username,
      isGuest: isGuest(p.user.id),
      checkinPending: p.checkinDeadlineAt !== undefined,
    });
  }
  return [...byUser.values()];
}

// Reuses roster()'s own per-user de-duplication (see its comment above) so
// the lobby's "N here" headcount can never disagree with the roster's own
// length for the same table — otherwise a dual-connected person would count
// twice here while appearing once in the roster list.
function occupancy(locationId: number, mode: ActivityMode): number {
  return roster(locationId, mode).length;
}

// Describes what a joining user walked into, for the log line only. Based on
// the same absolute phase_started_at/phase_end_at the latecomer-sync
// broadcast itself relies on, so "X minutes into a Y-minute block" is exact,
// not an approximation from whatever the client reports.
function joinTimingNote(db: DatabaseSync, locationId: number, mode: ActivityMode): string {
  const state = getTable(db, locationId, mode);
  if (state.status === "idle") return "Table was idle.";
  if (state.status === "break") return "Joined during break.";
  const elapsedMin = (Date.now() - state.phaseStartedAt!) / 60_000;
  const totalMin = state.durationMs! / 60_000;
  return `Joined mid-session: ${elapsedMin.toFixed(1)} of ${totalMin} minutes into the focus block.`;
}

// Which cycle's tickets a table's current status belongs to. During 'focus'
// and 'break', phase_started_at is the focus cycle's start — on the
// focus->break transition, phase_started_at is deliberately left untouched
// (see endFocus) so a table's tickets stay addressable by the same
// cycleStartAt all the way through its break. While 'idle', there's no
// current cycle yet, so this reports the upcoming one (the one new tickets
// are boarding for).
function cycleStartAtFor(state: RoomState): number {
  return state.status === "idle" ? nextCycleMark(Date.now(), CYCLE_START_GRANULARITY_MS) : state.phaseStartedAt!;
}

function timerPayload(db: DatabaseSync, locationId: number, mode: ActivityMode): TimerPayload {
  const state = getTable(db, locationId, mode);
  const durationMs = state.status === "idle" ? null : state.durationMs;
  const subphase = state.status === "focus" ? computeSubphase(mode, Date.now() - state.phaseStartedAt!) : null;
  return { status: state.status, phaseEndAt: state.phaseEndAt, durationMs, subphase };
}

// Drives the hub landing page: every connected socket is already in the
// "lobby" room regardless of what page it's on, so enriching this payload
// with a per-mode breakdown is what feeds the ModePicker's live per-mode
// counts with zero extra events or rooms to join.
function lobbySummary(db: DatabaseSync) {
  const locations = listLocations(db);
  return locations.map((location) => {
    const modes = ACTIVITY_MODES.map((mode) => {
      const state = getTable(db, location.id, mode);
      return {
        mode,
        status: state.status,
        occupants: occupancy(location.id, mode),
        ticketCount: countBoardedTickets(db, location.id, mode, cycleStartAtFor(state)),
        // Lets RoomPage's ModePicker show a live per-mode countdown ring and
        // named roster before anyone joins that table — without this, the
        // only live-updating signal on that page was the `status` word.
        timer: timerPayload(db, location.id, mode),
        roster: roster(location.id, mode).slice(0, TABLE_CAPACITY),
        shadowCount: shadowCount(location.id, mode),
      };
    });
    return {
      slug: location.slug,
      name: location.name,
      buildingSlug: location.buildingSlug,
      buildingName: location.buildingName,
      occupants: modes.reduce((sum, m) => sum + m.occupants, 0),
      shadowCount: ACTIVITY_MODES.reduce((sum, mode) => sum + shadowCount(location.id, mode), 0),
      modes,
      upcomingCount: countUpcomingSessions(db, location.id),
    };
  });
}

function broadcastLobby(io: Server, db: DatabaseSync): void {
  io.to("lobby").emit("lobby:update", lobbySummary(db));
}

// Exported so routes/schedule.ts can re-broadcast after planning or
// cancelling a session. A booking is hub-level, not mode-specific
// (scheduled_sessions has no activity_mode column), so calling this with no
// mode fans out to all 4 of that hub's tables.
export function broadcastRoom(io: Server, db: DatabaseSync, locationId: number, mode?: ActivityMode): void {
  if (mode === undefined) {
    for (const m of ACTIVITY_MODES) broadcastRoom(io, db, locationId, m);
    return;
  }
  const state = getTable(db, locationId, mode);
  const cycleStartAt = cycleStartAtFor(state);
  const key = tableKey(locationId, mode);
  const tickets = listTickets(db, locationId, mode, cycleStartAt);
  const whiteboard = whiteboards.get(key);
  io.to(roomName(locationId, mode)).emit("room:update", {
    mode,
    timer: timerPayload(db, locationId, mode),
    cycleStartAt,
    roster: roster(locationId, mode),
    shadowCount: shadowCount(locationId, mode),
    tickets: tickets.map((ticket) => ({
      ...ticket,
      kudos: getKudosForTicket(db, ticket.id),
    })),
    leaderUserId: leaderUserId(tickets),
    whiteboardOpenedAt: whiteboard?.openedAt ?? null,
    whiteboardText: whiteboard?.text ?? "",
    whiteboardHighlights: whiteboard?.highlights ?? [],
    peerReviewOpenedAt: peerReviews.get(key)?.openedAt ?? null,
    capacity: TABLE_CAPACITY,
    upcoming: listUpcomingSessions(db, locationId),
  });
}

// ---------------------------------------------------------------------------
// Scheduler: the sole driver of every focus-phase transition. Nobody can
// start, cancel, or extend a table's timer (Decision 2) — a table's fate for
// each hourly cycle is decided once, at the cycle mark, purely by whether
// anyone boarded a ticket in time.
// ---------------------------------------------------------------------------

function clearTableTimer(key: string): void {
  const existing = scheduledTransitions.get(key);
  if (existing) clearTimeout(existing);
  scheduledTransitions.delete(key);
  const subphase = subphaseTimers.get(key);
  if (subphase) subphase.forEach(clearTimeout);
  subphaseTimers.delete(key);
  // Easy to miss: without clearing this too, a rapid idle<->focus<->break
  // transition (e.g. in tests) would leak a stale fallback timer or let it
  // double-fire against the table's next cycle.
  const whiteboardFallback = whiteboardFallbackTimers.get(key);
  if (whiteboardFallback) clearTimeout(whiteboardFallback);
  whiteboardFallbackTimers.delete(key);
  const peerReview = peerReviewTimers.get(key);
  if (peerReview) clearTimeout(peerReview);
  peerReviewTimers.delete(key);
  const checkins = checkinTimers.get(key);
  if (checkins) checkins.forEach(clearTimeout);
  checkinTimers.delete(key);
}

// Arms the next transition for one (location, mode) table, however far in
// the future it is. Always re-arms after firing — a table's cadence never
// stops on its own, regardless of outcome (empty cycle, full focus block, or
// break), which is what makes a stale/duplicate timer impossible: there is
// always exactly one live timeout per table in scheduledTransitions.
function armNextTransition(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode): void {
  const key = tableKey(locationId, mode);
  clearTableTimer(key);
  const state = getTable(db, locationId, mode);
  const now = Date.now();

  if (state.status === "focus" || state.status === "break") {
    const delay = Math.max(0, state.phaseEndAt! - now);
    scheduledTransitions.set(
      key,
      setTimeout(() => {
        if (state.status === "focus") endFocus(io, db, locationId, mode);
        else endBreak(io, db, locationId, mode);
      }, delay),
    );
    if (state.status === "focus") {
      armSubphaseTimer(io, db, locationId, mode, state);
      armWhiteboardFallbackTimer(io, db, locationId, mode, state);
      armPeerReviewTimer(io, db, locationId, mode, state);
      armCheckinTimers(io, db, locationId, mode, state);
    }
    return;
  }

  // Idle: wait for the next hourly mark, then decide whether anyone boarded.
  // The mark is computed once, here, and threaded through to
  // beginScheduledFocus rather than re-derived from Date.now() when the
  // timeout fires — a few ms of ordinary timer slop past the mark would
  // otherwise round nextCycleMark up to the *next* mark instead of the one
  // that just elapsed.
  const mark = nextCycleMark(now, CYCLE_START_GRANULARITY_MS);
  scheduledTransitions.set(
    key,
    setTimeout(() => beginScheduledFocus(io, db, locationId, mode, mark), Math.max(0, mark - now)),
  );
}

// Forces a live re-broadcast at the solo->collab split instant — no DB
// write, nothing to self-heal after a restart (a restart during 'focus' just
// means clients recompute the current subphase on their next render, same as
// computeSubphase already does on every broadcast).
//
// Writing and Problem each get a second, independent broadcast for free at
// (or right after) the same split instant — armPeerReviewTimer and
// armWhiteboardFallbackTimer both call broadcastRoom too, plus every
// toggle-stuck/draft/highlight action during their collab window does the
// same. Concept Pitch has no such mechanic at all (confirmed: no pitch-
// specific socket handler exists), so it alone depends on this one timer
// firing and actually being delivered to every connected socket. A QA
// campaign surfaced exactly this: a purely passive Concept Pitch observer
// stuck seeing "Solo" for a full real hour after the one broadcast here
// apparently never reached it. Rather than chase an unconfirmed root cause
// in the delivery path, arm a second, independent catch-up broadcast shortly
// after the split for Pitch specifically (10s in real time, or half of a
// shortened test-speed collab window, whichever is smaller — still well
// inside the collab window either way), so a single missed delivery is never
// fatal.
function armSubphaseTimer(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, state: RoomState): void {
  const split = splitMsFor(mode);
  if (split === null) return;
  const key = tableKey(locationId, mode);
  const splitAt = state.phaseStartedAt! + split;
  const now = Date.now();
  const fire = () => broadcastRoom(io, db, locationId, mode);
  const timers: NodeJS.Timeout[] = [];

  const primaryDelay = splitAt - now;
  if (primaryDelay > 0) timers.push(setTimeout(fire, primaryDelay));

  if (mode === "pitch") {
    const collabWindowMs = state.phaseEndAt! - splitAt;
    const retryAt = splitAt + Math.max(1000, Math.min(collabWindowMs / 2, 10_000));
    const retryDelay = retryAt - now;
    if (retryDelay > 0 && retryAt < state.phaseEndAt!) timers.push(setTimeout(fire, retryDelay));
  }

  if (timers.length > 0) subphaseTimers.set(key, timers);
}

// Nobody should be able to silently deny the whole table a Whiteboard just by
// not clicking Launch: 60s after the Collab transition, auto-open it if no
// one has. Problem-Solving only — the only mode with a Whiteboard at all.
function armWhiteboardFallbackTimer(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, state: RoomState): void {
  if (mode !== "problem") return;
  const split = splitMsFor(mode);
  if (split === null) return;
  const key = tableKey(locationId, mode);
  const fallbackAt = state.phaseStartedAt! + split + 60_000;
  const delay = fallbackAt - Date.now();
  if (delay <= 0) return;
  whiteboardFallbackTimers.set(
    key,
    setTimeout(() => {
      if (whiteboards.get(key)?.openedAt != null) return;
      whiteboards.set(key, { text: "", highlights: [], openedAt: Date.now() });
      logSystemAction(db, locationId, "System", `Whiteboard auto-opened for ${mode} (fallback).`);
      broadcastRoom(io, db, locationId, mode);
    }, delay),
  );
}

// Opens the Peer Review portal automatically at the Collab split point
// (minute 40) — unlike the Whiteboard, there's no manual "Launch" step here,
// since the feature request describes it opening on its own. Writing Clinic
// only — the only mode with Peer Review at all.
function armPeerReviewTimer(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, state: RoomState): void {
  if (mode !== "writing") return;
  const split = splitMsFor(mode);
  if (split === null) return;
  const key = tableKey(locationId, mode);
  const openAt = state.phaseStartedAt! + split;
  const delay = openAt - Date.now();
  if (delay <= 0) return;
  peerReviewTimers.set(
    key,
    setTimeout(() => {
      if (peerReviews.get(key)?.openedAt != null) return;
      peerReviews.set(key, { openedAt: Date.now(), drafts: new Map(), assignments: new Map(), highlights: new Map() });
      logSystemAction(db, locationId, "System", `Peer Review opened for ${mode}.`);
      broadcastRoom(io, db, locationId, mode);
    }, delay),
  );
}

// Arms one table-wide timer per distinct check-in fire time across every
// Personal Shorter Duration preset (see allCheckinFireOffsetsMs) — not one
// timer set per user — and at each firing, filters recipients by whichever
// two offsets *their own* current ticket maps to. The ticket (and therefore
// personalDurationMs) is looked up fresh at fire time rather than cached at
// arm time, since room:submit-ticket lets a user change their personal
// duration mid-focus (the board form isn't hidden until break). A user with
// no ticket yet, or whose personalDurationMs is null, is treated as the full
// FOCUS_DURATION_MS block (today's behavior). A ping already answered or
// already past just no-ops inside requestCheckin itself rather than needing
// its own guard here.
function armCheckinTimers(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, state: RoomState): void {
  const key = tableKey(locationId, mode);
  const timers = allCheckinFireOffsetsMs()
    .map((offset) => ({ offset, delay: state.phaseStartedAt! + offset - Date.now() }))
    .filter(({ delay }) => delay > 0)
    .map(({ offset, delay }) =>
      setTimeout(() => {
        const table = presence.get(key);
        if (!table) return;
        for (const [socketId, entry] of [...table]) {
          const ticket = getTicket(db, locationId, mode, entry.user.id, state.phaseStartedAt!);
          const durationMs = ticket?.personalDurationMs ?? FOCUS_DURATION_MS;
          if (checkinOffsetsMsFor(durationMs).includes(offset)) requestCheckin(io, db, locationId, mode, socketId);
        }
      }, delay),
    );
  checkinTimers.set(key, timers);
}

function beginScheduledFocus(
  io: Server,
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  cycleStartAt: number,
): void {
  const boarded = countBoardedTickets(db, locationId, mode, cycleStartAt);
  if (boarded === 0) {
    logSystemAction(db, locationId, "System", `Cycle mark passed for ${mode} with no boarded tickets — staying idle.`);
    armNextTransition(io, db, locationId, mode);
    return;
  }
  // Fresh Whiteboard/Peer Review per cycle — a prior cycle's scratch text or
  // draft/highlight state must never leak into the next one's Collab window.
  whiteboards.delete(tableKey(locationId, mode));
  peerReviews.delete(tableKey(locationId, mode));
  setTableState(db, locationId, mode, "focus", cycleStartAt, cycleStartAt + FOCUS_DURATION_MS, FOCUS_DURATION_MS);
  logSystemAction(db, locationId, "System", `Focus began for ${mode} with ${boarded} boarded ticket(s).`);
  broadcastRoom(io, db, locationId, mode);
  broadcastLobby(io, db);
  armNextTransition(io, db, locationId, mode);
}

// Focus -> break. phase_started_at is deliberately left pointing at the focus
// cycle's start (not reset to "now") so tickets stay addressable by the same
// cycleStartAt all the way through break — see cycleStartAtFor.
function endFocus(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode): void {
  const state = getTable(db, locationId, mode);
  setTableState(db, locationId, mode, "break", state.phaseStartedAt, Date.now() + BREAK_DURATION_MS, BREAK_DURATION_MS);
  // beginScheduledFocus only ever transitions a cycle into focus when at
  // least one ticket boarded, so every endFocus call is a table that was
  // genuinely active — the Library Stats "rolled over N times" counter.
  incrementTableRollovers(db, locationId, mode);
  logSystemAction(db, locationId, "System", `Focus ended for ${mode}; break started.`);
  broadcastRoom(io, db, locationId, mode);
  broadcastLobby(io, db);
  armNextTransition(io, db, locationId, mode);
}

function endBreak(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode): void {
  const state = getTable(db, locationId, mode);
  setTableState(db, locationId, mode, "idle", null, null, null);
  logSystemAction(db, locationId, "System", `Break ended for ${mode}; table idle.`);
  broadcastRoom(io, db, locationId, mode);
  broadcastLobby(io, db);
  armNextTransition(io, db, locationId, mode);
}

// Boot-time self-heal: db.ts's own reconcileRoomStates() already resets any
// phase whose end time had already passed by the time the process (re)started
// — so by the time this runs, every table's row is honestly either idle, or
// mid-focus/break with a phase_end_at still genuinely in the future. This
// just arms the in-memory timer matching whatever reconcileRoomStates left
// behind, for all 104 (location, mode) pairs, so a restart can never leave a
// table silently un-scheduled or double-fire a transition that already
// happened on a previous process's clock.
export function rearmTimers(io: Server, db: DatabaseSync): void {
  for (const location of listLocations(db)) {
    for (const mode of ACTIVITY_MODES) {
      getOrCreateTable(db, location.id, mode);
      armNextTransition(io, db, location.id, mode);
    }
  }
}

// ---------------------------------------------------------------------------
// Micro check-ins: twice per focus block (CHECKIN_OFFSETS_MIN), every live
// Active user is pinged and must click-to-confirm within CHECKIN_GRACE_MS or
// is demoted back to Shadow — replacing tab-visibility as the activity
// signal (students legitimately tab away to code, use Google Docs, etc.).
// Demotion never evicts anyone or frees their ticket's capacity slot, since
// the 6-cap is about boarded tickets, not live connections — but it does
// revoke write access: every mutating handler's guard re-checks isDemoted()
// live (findPresence(...).demoted), the same way it re-checks isShadow,
// since this fires from a setTimeout with no reach into that connection's
// own closure state.
// ---------------------------------------------------------------------------

function findPresence(locationId: number, mode: ActivityMode, socketId: string): Presence | undefined {
  return presence.get(tableKey(locationId, mode))?.get(socketId);
}

// Fires a single ping at one presence: sets its deadline, notifies just that
// socket (check-in state is per-user, not shared table state, so this is a
// targeted emit rather than going through broadcastRoom/room:update), and
// arms the grace-period demotion timeout.
function requestCheckin(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, socketId: string): void {
  const entry = findPresence(locationId, mode, socketId);
  if (!entry || entry.demoted || entry.checkinDeadlineAt !== undefined) return;
  const deadlineAt = Date.now() + CHECKIN_GRACE_MS;
  entry.checkinDeadlineAt = deadlineAt;
  entry.penaltyTimeout = setTimeout(() => applyCheckinPenalty(io, db, locationId, mode, socketId), CHECKIN_GRACE_MS);
  io.to(socketId).emit("room:checkin-request", { deadlineAt });
  broadcastRoom(io, db, locationId, mode);
}

function confirmCheckin(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, socketId: string): void {
  const entry = findPresence(locationId, mode, socketId);
  if (!entry || entry.checkinDeadlineAt === undefined) return;
  entry.checkinDeadlineAt = undefined;
  if (entry.penaltyTimeout) clearTimeout(entry.penaltyTimeout);
  entry.penaltyTimeout = null;
  broadcastRoom(io, db, locationId, mode);
}

function applyCheckinPenalty(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, socketId: string): void {
  const entry = findPresence(locationId, mode, socketId);
  if (!entry || entry.checkinDeadlineAt === undefined) return;
  entry.demoted = true;
  entry.penaltyTimeout = null;
  const state = getTable(db, locationId, mode);
  if (state.status === "focus") {
    markTicketNotFullBlock(db, locationId, mode, entry.user.id, state.phaseStartedAt!);
    logRoomAction(db, locationId, identityLabel(entry.user, socketId), "Demoted to Shadow after missing a check-in.");
  }
  broadcastRoom(io, db, locationId, mode);
}

// ---------------------------------------------------------------------------
// Account deletion: no ownership concept survives this redesign (Decision 2
// removed `started_by` entirely), so there is no "force-end rooms I started"
// step anymore — deleting a user is purely removing that user's own rows.
// ---------------------------------------------------------------------------

export function deleteAccount(io: Server, db: DatabaseSync, userId: number): void {
  const affectedLocationIds = deleteUserScheduledSessions(db, userId);
  deleteUserChatMessages(db, userId);
  deleteUserTickets(db, userId);
  deleteUserKudosGiven(db, userId);
  deleteUserBuddies(db, userId);
  deleteUserStreaks(db, userId);
  deleteUserSessions(db, userId);
  deleteUserRow(db, userId);
  for (const locationId of affectedLocationIds) broadcastRoom(io, db, locationId);
  broadcastLobby(io, db);
}

// ---------------------------------------------------------------------------
// Validation helpers for room:submit-ticket and room:send-kudos.
// ---------------------------------------------------------------------------

function ticketBodyError(body: unknown): string | null {
  if (typeof body !== "string") return "invalid_ticket";
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_TICKET_LEN) return "invalid_ticket";
  const nonSpace = trimmed.replace(/\s/g, "");
  if (nonSpace.length < 3) return "invalid_ticket";
  if (VAGUE_TICKETS.has(trimmed.toLowerCase())) return "invalid_ticket";
  return null;
}

// Board-time personal duration: undefined/omitted means "full shared block"
// (stored as null, see upsertTicket). Anything present must match the fixed
// preset — never free-form minutes, per CLAUDE.md's "Simple Interface."
function personalDurationError(personalDurationMinutes: unknown): string | null {
  if (personalDurationMinutes === undefined || personalDurationMinutes === null) return null;
  if (typeof personalDurationMinutes !== "number") return "invalid_duration";
  if (!(PERSONAL_DURATION_PRESETS_MIN as readonly number[]).includes(personalDurationMinutes)) return "invalid_duration";
  return null;
}

// 50 (the full preset) stores as null so the shared FOCUS_DURATION_MS stays
// the single source of truth for the un-shortened block's exact length.
function personalDurationMsFor(personalDurationMinutes: number | undefined | null): number | null {
  if (personalDurationMinutes === undefined || personalDurationMinutes === null) return null;
  if (personalDurationMinutes >= 50) return null;
  return Math.round(FOCUS_DURATION_MS * (personalDurationMinutes / 50));
}

// Shared gate for every Whiteboard handler: Problem-Solving only, mid-focus,
// and only once that cycle has reached its Collab subphase — the Whiteboard
// doesn't exist outside that window.
function whiteboardSubphaseOk(db: DatabaseSync, locationId: number, mode: ActivityMode): boolean {
  if (mode !== "problem") return false;
  const state = getTable(db, locationId, mode);
  if (state.status !== "focus") return false;
  return computeSubphase(mode, Date.now() - state.phaseStartedAt!) === "collab";
}

// Shared gate for every Peer Review handler, exact same shape as
// whiteboardSubphaseOk — Writing Clinic only, mid-focus, Collab subphase.
function peerReviewSubphaseOk(db: DatabaseSync, locationId: number, mode: ActivityMode): boolean {
  if (mode !== "writing") return false;
  const state = getTable(db, locationId, mode);
  if (state.status !== "focus") return false;
  return computeSubphase(mode, Date.now() - state.phaseStartedAt!) === "collab";
}

function draftTextError(text: unknown): string | null {
  if (typeof text !== "string") return "invalid_draft";
  const trimmed = text.trim();
  if (trimmed.length < 1) return "invalid_draft";
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_DRAFT_WORDS) return "invalid_draft";
  return null;
}

// N-way shuffle (Decision: not reciprocal pairs): shuffle every current
// submitter into a random order, then each reviews the next person's draft
// (wrapping around) — A reviews B's, B reviews C's, C reviews A's. For n >= 3
// this guarantees nobody reviews the person reviewing them; at n === 2 mutual
// review is unavoidable and is the only well-defined assignment. Recomputed
// from scratch on every new submission (fine for a lightweight classroom
// feature — a late submitter simply reshuffles the whole rotation).
function recomputePeerReviewAssignments(state: PeerReviewState): void {
  const authorIds = [...state.drafts.keys()];
  state.assignments.clear();
  if (authorIds.length < 2) return;
  const shuffled = [...authorIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (let i = 0; i < shuffled.length; i++) {
    state.assignments.set(shuffled[i], shuffled[(i + 1) % shuffled.length]);
  }
}

// Delivers per-user Peer Review data via targeted emits (same precedent as
// room:checkin-request) rather than cramming user-scoped data into the shared
// broadcastRoom payload: a reviewer gets the draft they're assigned plus its
// highlights so far, and an author whose draft is under review gets a live
// refresh of the highlights landing on their own text — the "Live Replicated
// Effect" the feature request describes. Called after a draft submission
// (assignments may have changed) and after every new highlight.
function broadcastPeerReviewState(io: Server, locationId: number, mode: ActivityMode): void {
  const key = tableKey(locationId, mode);
  const state = peerReviews.get(key);
  if (!state) return;
  const table = presence.get(key);
  if (!table) return;
  for (const entry of table.values()) {
    const authorId = state.assignments.get(entry.user.id);
    if (authorId !== undefined) {
      const draft = state.drafts.get(authorId);
      if (draft) {
        io.to(entry.socketId).emit("room:peer-review-assignment", {
          authorId,
          authorUsername: draft.username,
          text: draft.text,
          highlights: state.highlights.get(authorId) ?? [],
        });
      }
    }
    if (state.drafts.has(entry.user.id)) {
      io.to(entry.socketId).emit("room:peer-review-highlights", {
        highlights: state.highlights.get(entry.user.id) ?? [],
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Socket handlers.
// ---------------------------------------------------------------------------

interface JoinedTable {
  locationId: number;
  mode: ActivityMode;
}

export function registerSocketHandlers(io: Server, db: DatabaseSync): void {
  io.on("connection", (socket: Socket) => {
    socket.join("lobby");
    // Without this, a freshly-connected socket only ever learns the lobby's
    // state reactively (the next time someone else's action happens to call
    // broadcastLobby) — a viewer landing on an already-occupied room could
    // see "0 people" indefinitely if nothing else nudges a broadcast.
    socket.emit("lobby:update", lobbySummary(db));
    // The client's socket is a shared singleton that survives SPA navigation
    // (see useTableSocket.ts's getSocket()), so remounting the Landing/
    // Building/Room page after visiting other pages finds an already-
    // connected socket — the snapshot above never re-fires, and the page is
    // stuck with whatever occupancy it last saw until some *other* user's
    // action happens to trigger broadcastLobby. A hard refresh masked this
    // by forcing a brand-new connection. Mirrors room:join's existing
    // already-connected re-request pattern (see reconnect() below).
    socket.on("lobby:join", () => socket.emit("lobby:update", lobbySummary(db)));
    let joined: JoinedTable | null = null;
    let isShadow = false;

    function currentIdentity(): Identity | undefined {
      return socket.data.user as Identity | undefined;
    }

    // applyCheckinPenalty() only flips Presence.demoted — it has no reach into
    // this connection's own isShadow closure, since it fires from a
    // setTimeout outside this closure and may run long after join-time set
    // it. Every mutating handler below re-checks this live, the same way the
    // old code's cleared socket.data.user was re-read live by every guard.
    function isDemoted(): boolean {
      if (!joined) return false;
      return findPresence(joined.locationId, joined.mode, socket.id)?.demoted === true;
    }

    socket.on("room:join", ({ slug, mode }: { slug?: string; mode?: ActivityMode }) => {
      if (joined) leaveTable(socket, io, db, joined, isShadow);
      const location = typeof slug === "string" ? getLocationBySlug(db, slug) : undefined;
      if (!location || !ACTIVITY_MODES.includes(mode as ActivityMode)) {
        socket.emit("room:error", { error: "not_found", action: "room:join" });
        return;
      }
      joined = { locationId: location.id, mode: mode as ActivityMode };
      const key = tableKey(joined.locationId, joined.mode);
      const user = currentIdentity();

      if (user) {
        isShadow = false;
        if (!presence.has(key)) presence.set(key, new Map());
        presence.get(key)!.set(socket.id, {
          socketId: socket.id,
          user,
          joinedAt: Date.now(),
          penaltyTimeout: null,
          demoted: false,
        });
        logSystemAction(db, joined.locationId, identityLabel(user, socket.id), `Joined ${joined.mode}. ${joinTimingNote(db, joined.locationId, joined.mode)}`);
      } else {
        isShadow = true;
        if (!shadowCounts.has(key)) shadowCounts.set(key, new Set());
        shadowCounts.get(key)!.add(socket.id);
      }

      const { locationId: joinedLocationId, mode: joinedMode } = joined;
      socket.join(roomName(joinedLocationId, joinedMode));
      const state = getOrCreateTable(db, joinedLocationId, joinedMode);
      const cycleStartAt = cycleStartAtFor(state);
      const myTicket = user ? getTicket(db, joinedLocationId, joinedMode, user.id, cycleStartAt) : undefined;
      socket.emit("room:joined", {
        location: { slug: location.slug, name: location.name },
        mode: joinedMode,
        modeInfo: ACTIVITY_MODE_INFO.find((m) => m.mode === joinedMode),
        myTicket: myTicket ?? null,
        isShadow,
      });
      broadcastRoom(io, db, joinedLocationId, joinedMode);
      broadcastLobby(io, db);
      // A user who (re)joins after the portal already opened still needs
      // their assignment/highlights without waiting for someone else's next
      // submission or highlight — room:update alone doesn't carry this
      // per-user-scoped data (see broadcastPeerReviewState's own comment).
      if (user) broadcastPeerReviewState(io, joinedLocationId, joinedMode);
    });

    socket.on("set_pseudonym", ({ pseudonym }: { pseudonym?: string }) => {
      if (!isShadow || typeof pseudonym !== "string") return;
      const trimmed = pseudonym.trim().slice(0, 24);
      if (trimmed.length < 1) return;
      const { token, identity } = createPseudonymIdentity(trimmed);
      socket.data.user = identity;
      socket.emit("pseudonym:set", { token, identity });
      if (joined) {
        isShadow = false;
        const key = tableKey(joined.locationId, joined.mode);
        shadowCounts.get(key)?.delete(socket.id);
        if (!presence.has(key)) presence.set(key, new Map());
        presence.get(key)!.set(socket.id, {
          socketId: socket.id,
          user: identity,
          joinedAt: Date.now(),
          penaltyTimeout: null,
          demoted: false,
        });
        logSystemAction(db, joined.locationId, identityLabel(identity, socket.id), `Set pseudonym and went Active in ${joined.mode}.`);
        broadcastRoom(io, db, joined.locationId, joined.mode);
        broadcastLobby(io, db);
      }
    });

    socket.on("room:checkin-confirm", () => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:checkin-confirm. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:checkin-confirm" });
        return;
      }
      confirmCheckin(io, db, joined.locationId, joined.mode, socket.id);
    });

    socket.on("room:submit-ticket", ({ body, personalDurationMinutes }: { body?: string; personalDurationMinutes?: number }) => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:submit-ticket. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:submit-ticket" });
        return;
      }
      const error = ticketBodyError(body);
      if (error) {
        socket.emit("room:error", { error, action: "room:submit-ticket" });
        return;
      }
      const durationError = personalDurationError(personalDurationMinutes);
      if (durationError) {
        socket.emit("room:error", { error: durationError, action: "room:submit-ticket" });
        return;
      }
      const { locationId, mode } = joined;
      const state = getOrCreateTable(db, locationId, mode);
      const cycleStartAt = cycleStartAtFor(state);
      const existing = getTicket(db, locationId, mode, user.id, cycleStartAt);
      if (!existing && countBoardedTickets(db, locationId, mode, cycleStartAt) >= TABLE_CAPACITY) {
        socket.emit("room:error", { error: "table_full", action: "room:submit-ticket" });
        return;
      }
      // Reboard streak (no group vote involved, see db.ts's StreakEntry
      // comment): only a brand-new board for this cycle (not an edit to an
      // already-boarded ticket) counts as "coming back," and it's judged
      // purely against this one user's own most recent prior ticket at this
      // table — did they complete it, or not.
      if (!existing && !isGuest(user.id)) {
        const previous = getPreviousTicket(db, locationId, mode, user.id, cycleStartAt);
        if (previous) {
          // Pivoted preserves/increments the streak same as Completed
          // (locked-in decision) — a pivot is still a finished, checked-out
          // ticket, just one whose goal changed mid-block.
          if (previous.stamp === "completed" || previous.stamp === "pivoted") incrementStreak(db, user.id, locationId, mode);
          else resetStreak(db, user.id, locationId, mode);
        }
      }
      upsertTicket(
        db,
        locationId,
        mode,
        user.id,
        user.username,
        cycleStartAt,
        (body as string).trim(),
        personalDurationMsFor(personalDurationMinutes),
      );
      logRoomAction(db, locationId, identityLabel(user, socket.id), `Submitted ticket for ${mode}: "${(body as string).trim()}"`);
      broadcastRoom(io, db, locationId, mode);
      broadcastLobby(io, db);
    });

    // Pivot Goal: rewrite your own in-progress ticket's body mid-focus,
    // distinct from room:submit-ticket (which boards or silently edits a
    // not-yet-locked ticket) so the client can reliably diff old-vs-new body
    // for the strikethrough/retype animation on everyone else's screen.
    socket.on("room:pivot-ticket", ({ body }: { body?: string }) => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:pivot-ticket. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:pivot-ticket" });
        return;
      }
      const error = ticketBodyError(body);
      if (error) {
        socket.emit("room:error", { error, action: "room:pivot-ticket" });
        return;
      }
      const { locationId, mode } = joined;
      const state = getTable(db, locationId, mode);
      if (state.status !== "focus") {
        socket.emit("room:error", { error: "not_focusing", action: "room:pivot-ticket" });
        return;
      }
      const cycleStartAt = cycleStartAtFor(state);
      const existing = getTicket(db, locationId, mode, user.id, cycleStartAt);
      if (!existing) {
        socket.emit("room:error", { error: "no_ticket", action: "room:pivot-ticket" });
        return;
      }
      const previousBody = existing.body;
      const trimmed = (body as string).trim();
      pivotTicket(db, locationId, mode, user.id, cycleStartAt, trimmed);
      logRoomAction(db, locationId, identityLabel(user, socket.id), `Pivoted ticket: "${previousBody}" -> "${trimmed}"`);
      broadcastRoom(io, db, locationId, mode);
    });

    socket.on("room:toggle-stuck", () => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:toggle-stuck. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:toggle-stuck" });
        return;
      }
      const { locationId, mode } = joined;
      if (mode !== "problem") {
        socket.emit("room:error", { error: "wrong_mode", action: "room:toggle-stuck" });
        return;
      }
      const state = getTable(db, locationId, mode);
      const cycleStartAt = cycleStartAtFor(state);
      toggleStuck(db, locationId, mode, user.id, cycleStartAt);
      broadcastRoom(io, db, locationId, mode);
    });

    socket.on("room:stamp-ticket", ({ stamp }: { stamp?: TicketStamp }) => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:stamp-ticket. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:stamp-ticket" });
        return;
      }
      const { locationId, mode } = joined;
      const state = getTable(db, locationId, mode);
      // A Personal Shorter Duration ticket (see PERSONAL_DURATION_PRESETS_MIN)
      // may check out as soon as its own block elapses, even while the table
      // is still "focus" for everyone else — this is the one carve-out to the
      // otherwise break-only stamping ritual (see early-finish-stamp.test.ts).
      const myTicketForEligibility =
        state.status === "focus" ? getTicket(db, locationId, mode, user.id, state.phaseStartedAt!) : undefined;
      const personalDone =
        myTicketForEligibility?.personalDurationMs != null &&
        Date.now() >= state.phaseStartedAt! + myTicketForEligibility.personalDurationMs;
      const eligible = state.status === "break" || (state.status === "focus" && personalDone);
      if (!eligible || (stamp !== "completed" && stamp !== "partial" && stamp !== "pivoted")) {
        socket.emit("room:error", { error: "not_breaking", action: "room:stamp-ticket" });
        return;
      }
      if (stamp === "pivoted") {
        // Only offer this stamp to a ticket that was actually pivoted — the
        // Break Modal already hides the button otherwise, this is the
        // server-side half of that same contract.
        const ticket = getTicket(db, locationId, mode, user.id, state.phaseStartedAt!);
        if (!ticket || ticket.pivotedAt == null) {
          socket.emit("room:error", { error: "not_pivoted", action: "room:stamp-ticket" });
          return;
        }
      }
      stampTicket(db, locationId, mode, user.id, state.phaseStartedAt!, stamp);
      logRoomAction(db, locationId, identityLabel(user, socket.id), `Stamped ticket as ${stamp}.`);
      broadcastRoom(io, db, locationId, mode);
    });

    socket.on("room:send-kudos", ({ toUserId, emoji }: { toUserId?: number; emoji?: string }) => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:send-kudos. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:send-kudos" });
        return;
      }
      const { locationId, mode } = joined;
      const state = getTable(db, locationId, mode);
      // Kudos is a lightweight predefined reaction (CLAUDE.md's "Kudos
      // emojis" carve-out), not a break-only ritual like stamping — letting
      // it fire during focus too lets a table cheer each other on mid-block.
      if ((state.status !== "break" && state.status !== "focus") || typeof emoji !== "string" || !KUDOS_EMOJI.has(emoji)) {
        socket.emit("room:error", { error: "not_breaking", action: "room:send-kudos" });
        return;
      }
      if (toUserId === user.id) {
        socket.emit("room:error", { error: "self_kudos", action: "room:send-kudos" });
        return;
      }
      const recipientTicket = getTicket(db, locationId, mode, toUserId as number, state.phaseStartedAt!);
      if (!recipientTicket) {
        socket.emit("room:error", { error: "not_found", action: "room:send-kudos" });
        return;
      }
      const given = addKudos(db, recipientTicket.id, user.id, emoji);
      if (!given) {
        socket.emit("room:error", { error: "already_given", action: "room:send-kudos" });
        return;
      }
      logRoomAction(db, locationId, identityLabel(user, socket.id), `Sent ${emoji} kudos to '${recipientTicket.username}'.`);
      broadcastRoom(io, db, locationId, mode);
    });

    socket.on("room:launch-whiteboard", () => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:launch-whiteboard. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:launch-whiteboard" });
        return;
      }
      const { locationId, mode } = joined;
      if (!whiteboardSubphaseOk(db, locationId, mode)) {
        socket.emit("room:error", { error: "wrong_mode", action: "room:launch-whiteboard" });
        return;
      }
      whiteboards.set(tableKey(locationId, mode), { text: "", highlights: [], openedAt: Date.now() });
      logRoomAction(db, locationId, identityLabel(user, socket.id), "Launched the Whiteboard.");
      broadcastRoom(io, db, locationId, mode);
    });

    socket.on("room:whiteboard-paste", ({ text }: { text?: string }) => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:whiteboard-paste. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:whiteboard-paste" });
        return;
      }
      const { locationId, mode } = joined;
      if (!whiteboardSubphaseOk(db, locationId, mode)) {
        socket.emit("room:error", { error: "wrong_mode", action: "room:whiteboard-paste" });
        return;
      }
      const whiteboard = whiteboards.get(tableKey(locationId, mode));
      if (!whiteboard || whiteboard.openedAt === null) {
        socket.emit("room:error", { error: "not_open", action: "room:whiteboard-paste" });
        return;
      }
      if (typeof text !== "string" || text.length > MAX_WHITEBOARD_TEXT_LEN) {
        socket.emit("room:error", { error: "invalid_paste", action: "room:whiteboard-paste" });
        return;
      }
      whiteboard.text = text;
      broadcastRoom(io, db, locationId, mode);
    });

    socket.on("room:whiteboard-highlight", ({ start, end }: { start?: number; end?: number }) => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:whiteboard-highlight. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:whiteboard-highlight" });
        return;
      }
      const { locationId, mode } = joined;
      if (!whiteboardSubphaseOk(db, locationId, mode)) {
        socket.emit("room:error", { error: "wrong_mode", action: "room:whiteboard-highlight" });
        return;
      }
      const whiteboard = whiteboards.get(tableKey(locationId, mode));
      if (!whiteboard || whiteboard.openedAt === null) {
        socket.emit("room:error", { error: "not_open", action: "room:whiteboard-highlight" });
        return;
      }
      if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start
      ) {
        socket.emit("room:error", { error: "invalid_highlight", action: "room:whiteboard-highlight" });
        return;
      }
      // Defensive cap, not a real UX limit — a runaway client shouldn't be
      // able to grow this array unbounded for the whiteboard's 10-minute life.
      if (whiteboard.highlights.length >= MAX_WHITEBOARD_HIGHLIGHTS) whiteboard.highlights.shift();
      whiteboard.highlights.push({ start, end, byUserId: user.id });
      broadcastRoom(io, db, locationId, mode);
    });

    // Live cursors: a brand-new broadcast category, deliberately outside
    // broadcastRoom/room:update. Never written to SQLite, never throttled
    // server-side (the client self-throttles to ~20Hz before emitting), and
    // excluded from the sender so nobody sees their own cursor echoed back.
    // Silently dropped on a failed gate rather than room:error — this can
    // fire many times a second and isn't a user-initiated action worth
    // surfacing an error for.
    socket.on("room:whiteboard-cursor", ({ x, y }: { x?: number; y?: number }) => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) return;
      const { locationId, mode } = joined;
      if (!whiteboardSubphaseOk(db, locationId, mode)) return;
      const whiteboard = whiteboards.get(tableKey(locationId, mode));
      if (!whiteboard || whiteboard.openedAt === null) return;
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
      socket.to(roomName(locationId, mode)).emit("whiteboard:cursor", { userId: user.id, x, y });
    });

    // Peer Review: paste up to 200 words of your draft once the portal is
    // open. Re-submitting replaces your own draft in place and reshuffles the
    // N-way rotation (fine for a lightweight classroom feature — see
    // recomputePeerReviewAssignments).
    socket.on("room:submit-draft", ({ text }: { text?: string }) => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:submit-draft. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:submit-draft" });
        return;
      }
      const { locationId, mode } = joined;
      if (!peerReviewSubphaseOk(db, locationId, mode)) {
        socket.emit("room:error", { error: "wrong_mode", action: "room:submit-draft" });
        return;
      }
      const key = tableKey(locationId, mode);
      const state = peerReviews.get(key);
      if (!state || state.openedAt === null) {
        socket.emit("room:error", { error: "not_open", action: "room:submit-draft" });
        return;
      }
      const error = draftTextError(text);
      if (error) {
        socket.emit("room:error", { error, action: "room:submit-draft" });
        return;
      }
      state.drafts.set(user.id, { userId: user.id, username: user.username, text: (text as string).trim() });
      recomputePeerReviewAssignments(state);
      logRoomAction(db, locationId, identityLabel(user, socket.id), "Submitted a draft for Peer Review.");
      broadcastPeerReviewState(io, locationId, mode);
    });

    // Highlighting: only the reviewer assigned to this author's draft may
    // highlight it (checked against the N-way rotation, not just "anyone at
    // the table"), and only with one of the three fixed kinds — no typed
    // feedback, per the feature request.
    socket.on(
      "room:peer-highlight",
      ({ authorId, start, end, kind }: { authorId?: number; start?: number; end?: number; kind?: PeerReviewHighlightKind }) => {
        if (!joined) return;
        const user = currentIdentity();
        if (!user || isShadow || isDemoted()) {
          logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:peer-highlight. Rejected.");
          socket.emit("room:error", { error: "unauthorized", action: "room:peer-highlight" });
          return;
        }
        const { locationId, mode } = joined;
        if (!peerReviewSubphaseOk(db, locationId, mode)) {
          socket.emit("room:error", { error: "wrong_mode", action: "room:peer-highlight" });
          return;
        }
        const state = peerReviews.get(tableKey(locationId, mode));
        if (!state || state.openedAt === null) {
          socket.emit("room:error", { error: "not_open", action: "room:peer-highlight" });
          return;
        }
        if (state.assignments.get(user.id) !== authorId) {
          socket.emit("room:error", { error: "not_assigned", action: "room:peer-highlight" });
          return;
        }
        if (
          typeof start !== "number" ||
          typeof end !== "number" ||
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end < start ||
          (kind !== "strong" && kind !== "confusing" && kind !== "citation")
        ) {
          socket.emit("room:error", { error: "invalid_highlight", action: "room:peer-highlight" });
          return;
        }
        const highlights = state.highlights.get(authorId as number) ?? [];
        if (highlights.length >= MAX_PEER_REVIEW_HIGHLIGHTS) highlights.shift();
        highlights.push({ start, end, kind, byUserId: user.id });
        state.highlights.set(authorId as number, highlights);
        broadcastPeerReviewState(io, locationId, mode);
      },
    );

    socket.on("room:leave", () => {
      if (!joined) return;
      leaveTable(socket, io, db, joined, isShadow);
      socket.leave(roomName(joined.locationId, joined.mode));
      joined = null;
      isShadow = false;
    });

    socket.on("disconnect", () => {
      if (joined) leaveTable(socket, io, db, joined, isShadow);
    });
  });
}

function leaveTable(socket: Socket, io: Server, db: DatabaseSync, joined: JoinedTable, isShadow: boolean): void {
  const { locationId, mode } = joined;
  const key = tableKey(locationId, mode);
  if (isShadow) {
    shadowCounts.get(key)?.delete(socket.id);
  } else {
    const entry = presence.get(key)?.get(socket.id);
    if (entry?.penaltyTimeout) clearTimeout(entry.penaltyTimeout);
    presence.get(key)?.delete(socket.id);
    const user = socket.data.user as Identity | undefined;
    if (user) {
      logSystemAction(db, locationId, identityLabel(user, socket.id), `Left ${mode}.`);
      autoStampAbandonedTicket(db, locationId, mode, user, key, socket.id);
    }
  }
  broadcastRoom(io, db, locationId, mode);
  broadcastLobby(io, db);
}

// A ticket holder who finished their session but disconnects before ever
// clicking a stamp button has no remaining way to check out — the modal that
// would ask them left with their connection. Auto-credit them as "completed"
// the moment they become unreachable, but only when this was their LAST live
// connection to this table (a second open tab can still stamp manually) and
// only once their session is genuinely over:
//   - "break": the ordinary case — the table-wide focus block has ended, so
//     anyone still holding an un-stamped, stayed_full_block ticket gets
//     credited (see persistent-stats.test.ts's "crediting only the one who
//     stamped": staying connected through break without stamping must still
//     get 0 while they ARE connected — this only fires on the disconnect).
//   - "focus": a personal-duration ticket (see PERSONAL_DURATION_PRESETS_MIN)
//     whose own shorter block has already elapsed, even though the table
//     itself is still "focus" for everyone else — mirrors room:stamp-ticket's
//     own early-finish carve-out. An ordinary full-block ticket must still
//     get nothing here (see persistent-stats.test.ts's "earns zero VFH for a
//     ticket whose holder left before the block ended").
//   - "idle": the table has already rolled over past break (endBreak nulls
//     phase_started_at), so there's no cycle key left to look the ticket up
//     by directly — getMostRecentStartedTicket finds it by scanning backward
//     from now instead. This only fires on an actual disconnect, so it can
//     never retroactively credit someone who just stays connected.
function autoStampAbandonedTicket(
  db: DatabaseSync,
  locationId: number,
  mode: ActivityMode,
  user: Identity,
  key: string,
  socketId: string,
): void {
  const stillConnectedElsewhere = [...(presence.get(key)?.values() ?? [])].some((p) => p.user.id === user.id);
  if (stillConnectedElsewhere) return;
  const state = getTable(db, locationId, mode);

  let ticket: Ticket | undefined;
  if (state.status === "break" && state.phaseStartedAt !== null) {
    ticket = getTicket(db, locationId, mode, user.id, state.phaseStartedAt);
  } else if (state.status === "focus" && state.phaseStartedAt !== null) {
    const candidate = getTicket(db, locationId, mode, user.id, state.phaseStartedAt);
    const personalDone =
      candidate?.personalDurationMs != null && Date.now() >= state.phaseStartedAt + candidate.personalDurationMs;
    if (personalDone) ticket = candidate;
  } else if (state.status === "idle") {
    ticket = getMostRecentStartedTicket(db, locationId, mode, user.id, Date.now());
  }

  if (!ticket || ticket.stamp !== null || !ticket.stayedFullBlock) return;
  stampTicket(db, locationId, mode, user.id, ticket.cycleStartAt, "completed");
  logRoomAction(db, locationId, identityLabel(user, socketId), "Auto-stamped ticket as completed after disconnecting without checking out.");
}
