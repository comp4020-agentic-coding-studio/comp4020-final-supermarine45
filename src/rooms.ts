import type { DatabaseSync } from "node:sqlite";
import type { Server, Socket } from "socket.io";
import type { ActivityMode, Identity, Location, RoomState, RoomStatus, Ticket } from "./db.js";
import {
  ACTIVITY_MODES,
  addKudos,
  castVote,
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
  getOrCreateTable,
  getTable,
  getTicket,
  incrementStreak,
  isGuest,
  listLocations,
  listTickets,
  listUpcomingSessions,
  markTicketNotFullBlock,
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

const MAX_TICKET_LEN = 60;
const VAGUE_TICKETS = new Set(["study", "work", "homework", "stuff", "things", "read", "reading"]);
const KUDOS_EMOJI = new Set(["⚡", "☕", "🧠"]);
// Defensive caps on the Whiteboard — a scratch surface for pasted
// code/problem text, not an open-ended document.
const MAX_WHITEBOARD_TEXT_LEN = 2000;
const MAX_WHITEBOARD_HIGHLIGHTS = 100;

// Programmatic honesty (Week 11): how long an Active user's tab may stay
// hidden before the server demotes them back to Shadow. Server-timed and
// server-enforced — the client only ever reports visibility, never the
// verdict. See markTabHidden/applyTabPenalty. Independently overridable from
// TABLE_CYCLE_MS (same process.env.X || default convention) because it's a
// fixed human-behavior constant, not a fraction of the hourly cycle — a
// shortened test cycle needs this shortened too, or a 60s penalty could
// never fire inside a test-speed focus block at all.
export const TAB_HIDDEN_PENALTY_MS = Number(process.env.TAB_HIDDEN_PENALTY_MS) || 60_000;

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
  // Tab-focus telemetry (Week 11): when this user's tab last went hidden
  // (null if currently visible/never hidden), the pending 60s demotion
  // timeout armed when it did, and whether that timeout already fired.
  tabHiddenAt: number | null;
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
  tabHidden: boolean;
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
// tableKey -> the one-off timeout that forces a re-broadcast at a mode's
// solo->collab split point. Deliberately separate from scheduledTransitions:
// this one never changes DB state, it just makes the subphase flip show up
// live instead of waiting for some other event to trigger a broadcast.
const subphaseTimers = new Map<string, NodeJS.Timeout>();
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
// tableKey -> the fallback timer that auto-opens the Whiteboard if the Leader
// never clicks Launch, so a disengaged Leader can't block the table.
const whiteboardFallbackTimers = new Map<string, NodeJS.Timeout>();
// tableKey -> when the Rollover Vote opened this break (null/absent until
// opened, by the Leader or by the fallback timer). Cleared at the start of
// every new focus cycle, same lifetime as the whiteboard.
const voteOpenedAt = new Map<string, number>();
// tableKey -> the fallback timer that auto-opens voting near the end of
// break if the Leader never clicks Initiate.
const voteFallbackTimers = new Map<string, NodeJS.Timeout>();

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
// can strand one of them in the DOM instead of removing it. tabHidden is
// OR'd across a person's connections so any hidden tab still raises the
// warning, matching the penalty mechanism's per-connection risk tracking.
function roster(locationId: number, mode: ActivityMode): RosterEntry[] {
  const table = presence.get(tableKey(locationId, mode));
  if (!table) return [];
  const byUser = new Map<number, RosterEntry>();
  for (const p of table.values()) {
    if (p.demoted) continue;
    const existing = byUser.get(p.user.id);
    if (existing) {
      existing.tabHidden = existing.tabHidden || p.tabHiddenAt !== null;
      continue;
    }
    byUser.set(p.user.id, {
      userId: p.user.id,
      username: p.user.username,
      isGuest: isGuest(p.user.id),
      tabHidden: p.tabHiddenAt !== null,
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
function broadcastLobby(io: Server, db: DatabaseSync): void {
  const locations = listLocations(db);
  const summary = locations.map((location) => {
    const modes = ACTIVITY_MODES.map((mode) => {
      const state = getTable(db, location.id, mode);
      return {
        mode,
        status: state.status,
        occupants: occupancy(location.id, mode),
        ticketCount: countBoardedTickets(db, location.id, mode, cycleStartAtFor(state)),
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
  io.to("lobby").emit("lobby:update", summary);
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
    voteOpenedAt: voteOpenedAt.get(key) ?? null,
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
  if (subphase) clearTimeout(subphase);
  subphaseTimers.delete(key);
  // Easy to miss: without clearing these too, a rapid idle<->focus<->break
  // transition (e.g. in tests) would leak a stale fallback timer or let it
  // double-fire against the table's next cycle.
  const whiteboardFallback = whiteboardFallbackTimers.get(key);
  if (whiteboardFallback) clearTimeout(whiteboardFallback);
  whiteboardFallbackTimers.delete(key);
  const voteFallback = voteFallbackTimers.get(key);
  if (voteFallback) clearTimeout(voteFallback);
  voteFallbackTimers.delete(key);
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
    } else {
      armVoteFallbackTimer(io, db, locationId, mode, state);
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

// A one-off timeout purely to force a live re-broadcast at the solo->collab
// split instant — no DB write, nothing to self-heal after a restart (a
// restart during 'focus' just means clients recompute the current subphase
// on their next render, same as computeSubphase already does on every
// broadcast).
function armSubphaseTimer(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, state: RoomState): void {
  const split = splitMsFor(mode);
  if (split === null) return;
  const key = tableKey(locationId, mode);
  const splitAt = state.phaseStartedAt! + split;
  const delay = splitAt - Date.now();
  if (delay <= 0) return;
  subphaseTimers.set(
    key,
    setTimeout(() => broadcastRoom(io, db, locationId, mode), delay),
  );
}

// A disengaged/AFK Leader must not be able to silently deny the whole table
// a Whiteboard: 60s after the Collab transition, auto-open it if the Leader
// still hasn't clicked Launch. Problem-Solving only — the only mode with a
// Whiteboard at all.
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
      logSystemAction(db, locationId, "System", `Whiteboard auto-opened for ${mode} (Leader fallback).`);
      broadcastRoom(io, db, locationId, mode);
    }, delay),
  );
}

// Same fallback philosophy for the Rollover Vote: if the Leader never clicks
// Initiate, auto-open voting near the end of break so the table still gets a
// chance to vote before the cycle resolves. Scaled proportionally off
// BREAK_DURATION_MS (like splitMsFor scales off FOCUS_DURATION_MS) so this
// still fires at a sane point under a shortened test-speed cycle.
function armVoteFallbackTimer(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, state: RoomState): void {
  const key = tableKey(locationId, mode);
  const fallbackAt = state.phaseEndAt! - BREAK_DURATION_MS * (2 / 10);
  const delay = fallbackAt - Date.now();
  if (delay <= 0) return;
  voteFallbackTimers.set(
    key,
    setTimeout(() => {
      if (voteOpenedAt.has(key)) return;
      voteOpenedAt.set(key, Date.now());
      logSystemAction(db, locationId, "System", `Rollover Vote auto-opened for ${mode} (Leader fallback).`);
      broadcastRoom(io, db, locationId, mode);
    }, delay),
  );
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
  // Fresh Whiteboard per cycle — a prior cycle's scratch text must never
  // leak into the next one's Collab window.
  whiteboards.delete(tableKey(locationId, mode));
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
  // Fresh vote window per break — any stale "opened" flag from a previous
  // cycle (shouldn't exist, but keeps this self-healing) must not linger.
  voteOpenedAt.delete(tableKey(locationId, mode));
  setTableState(db, locationId, mode, "break", state.phaseStartedAt, Date.now() + BREAK_DURATION_MS, BREAK_DURATION_MS);
  logSystemAction(db, locationId, "System", `Focus ended for ${mode}; break started.`);
  broadcastRoom(io, db, locationId, mode);
  broadcastLobby(io, db);
  armNextTransition(io, db, locationId, mode);
}

// Resolves the Rollover Vote and updates each boarded user's streak, before
// the table state is wiped back to idle (and the cycle's tickets become
// unaddressable for next cycle's query, since cycle_start_at will change).
// Quorum: at least half of the cycle's boarded tickets must have cast a vote
// at all, and among those cast, yes must outnumber no. Anyone who didn't
// vote is treated as not continuing (same as an explicit "no") — this scales
// with table size rather than using a flat vote-count threshold, so a
// 6-person table can't be swung by one straggler's vote.
function resolveVotesAndStreaks(db: DatabaseSync, locationId: number, mode: ActivityMode, cycleStartAt: number): void {
  const tickets = listTickets(db, locationId, mode, cycleStartAt);
  if (tickets.length === 0) return;
  const yes = tickets.filter((t) => t.vote === "yes").length;
  const no = tickets.filter((t) => t.vote === "no").length;
  const quorumMet = yes + no >= Math.ceil(tickets.length / 2);
  const passed = quorumMet && yes > no;
  for (const ticket of tickets) {
    if (isGuest(ticket.userId)) continue;
    if (passed && ticket.vote === "yes") incrementStreak(db, ticket.userId, locationId, mode);
    else resetStreak(db, ticket.userId, locationId, mode);
  }
}

function endBreak(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode): void {
  const state = getTable(db, locationId, mode);
  resolveVotesAndStreaks(db, locationId, mode, state.phaseStartedAt!);
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
// Tab-visibility telemetry (Week 11 carryover): a user whose tab stays hidden
// for TAB_HIDDEN_PENALTY_MS is demoted — their Focus Ring goes dark and their
// current-cycle ticket is marked not-full-block, so VFH withholds credit even
// if they come back and stamp afterward. Demotion never evicts anyone or
// frees their ticket's capacity slot, since the 6-cap is about boarded
// tickets, not live connections — but it does revoke write access: every
// mutating handler's guard re-checks isDemoted() live (findPresence(...)
// .demoted), the same way it re-checks isShadow, since this fires from a
// setTimeout with no reach into that connection's own closure state.
// ---------------------------------------------------------------------------

function findPresence(locationId: number, mode: ActivityMode, socketId: string): Presence | undefined {
  return presence.get(tableKey(locationId, mode))?.get(socketId);
}

function markTabHidden(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, socketId: string): void {
  const entry = findPresence(locationId, mode, socketId);
  if (!entry || entry.tabHiddenAt !== null) return;
  entry.tabHiddenAt = Date.now();
  entry.penaltyTimeout = setTimeout(
    () => applyTabPenalty(io, db, locationId, mode, socketId),
    TAB_HIDDEN_PENALTY_MS,
  );
  broadcastRoom(io, db, locationId, mode);
}

function clearTabHidden(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, socketId: string): void {
  const entry = findPresence(locationId, mode, socketId);
  if (!entry || entry.tabHiddenAt === null) return;
  entry.tabHiddenAt = null;
  if (entry.penaltyTimeout) clearTimeout(entry.penaltyTimeout);
  entry.penaltyTimeout = null;
  broadcastRoom(io, db, locationId, mode);
}

function applyTabPenalty(io: Server, db: DatabaseSync, locationId: number, mode: ActivityMode, socketId: string): void {
  const entry = findPresence(locationId, mode, socketId);
  if (!entry || entry.tabHiddenAt === null) return;
  entry.demoted = true;
  entry.penaltyTimeout = null;
  const state = getTable(db, locationId, mode);
  if (state.status === "focus") {
    markTicketNotFullBlock(db, locationId, mode, entry.user.id, state.phaseStartedAt!);
    logRoomAction(db, locationId, identityLabel(entry.user, socketId), "Demoted to Shadow after 60s of tab hidden.");
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

// Shared gate for every Whiteboard handler: Problem-Solving only, mid-focus,
// and only once that cycle has reached its Collab subphase — the Whiteboard
// doesn't exist outside that window.
function whiteboardSubphaseOk(db: DatabaseSync, locationId: number, mode: ActivityMode): boolean {
  if (mode !== "problem") return false;
  const state = getTable(db, locationId, mode);
  if (state.status !== "focus") return false;
  return computeSubphase(mode, Date.now() - state.phaseStartedAt!) === "collab";
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
    let joined: JoinedTable | null = null;
    let isShadow = false;

    function currentIdentity(): Identity | undefined {
      return socket.data.user as Identity | undefined;
    }

    // applyTabPenalty() only flips Presence.demoted — it has no reach into
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
          tabHiddenAt: null,
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
          tabHiddenAt: null,
          penaltyTimeout: null,
          demoted: false,
        });
        logSystemAction(db, joined.locationId, identityLabel(identity, socket.id), `Set pseudonym and went Active in ${joined.mode}.`);
        broadcastRoom(io, db, joined.locationId, joined.mode);
        broadcastLobby(io, db);
      }
    });

    socket.on("tab_hidden", () => {
      if (!joined || isShadow) return;
      markTabHidden(io, db, joined.locationId, joined.mode, socket.id);
    });

    socket.on("tab_visible", () => {
      if (!joined || isShadow) return;
      clearTabHidden(io, db, joined.locationId, joined.mode, socket.id);
    });

    socket.on("room:submit-ticket", ({ body }: { body?: string }) => {
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
      const { locationId, mode } = joined;
      const state = getOrCreateTable(db, locationId, mode);
      const cycleStartAt = cycleStartAtFor(state);
      const existing = getTicket(db, locationId, mode, user.id, cycleStartAt);
      if (!existing && countBoardedTickets(db, locationId, mode, cycleStartAt) >= TABLE_CAPACITY) {
        socket.emit("room:error", { error: "table_full", action: "room:submit-ticket" });
        return;
      }
      upsertTicket(db, locationId, mode, user.id, user.username, cycleStartAt, (body as string).trim());
      logRoomAction(db, locationId, identityLabel(user, socket.id), `Submitted ticket for ${mode}: "${(body as string).trim()}"`);
      broadcastRoom(io, db, locationId, mode);
      broadcastLobby(io, db);
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
      if (state.status !== "break" || (stamp !== "completed" && stamp !== "partial")) {
        socket.emit("room:error", { error: "not_breaking", action: "room:stamp-ticket" });
        return;
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
      if (state.status !== "break" || typeof emoji !== "string" || !KUDOS_EMOJI.has(emoji)) {
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
      const state = getTable(db, locationId, mode);
      const tickets = listTickets(db, locationId, mode, cycleStartAtFor(state));
      if (user.id !== leaderUserId(tickets)) {
        socket.emit("room:error", { error: "not_leader", action: "room:launch-whiteboard" });
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
    // surfacing an error for, same posture as tab_hidden/tab_visible above.
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

    socket.on("room:cast-vote", ({ vote }: { vote?: "yes" | "no" }) => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:cast-vote. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:cast-vote" });
        return;
      }
      const { locationId, mode } = joined;
      const state = getTable(db, locationId, mode);
      if (state.status !== "break" || (vote !== "yes" && vote !== "no")) {
        socket.emit("room:error", { error: "not_breaking", action: "room:cast-vote" });
        return;
      }
      const ticket = getTicket(db, locationId, mode, user.id, state.phaseStartedAt!);
      if (!ticket) {
        socket.emit("room:error", { error: "not_found", action: "room:cast-vote" });
        return;
      }
      castVote(db, locationId, mode, user.id, state.phaseStartedAt!, vote);
      logRoomAction(db, locationId, identityLabel(user, socket.id), `Cast Rollover Vote: ${vote}.`);
      broadcastRoom(io, db, locationId, mode);
    });

    socket.on("room:initiate-vote", () => {
      if (!joined) return;
      const user = currentIdentity();
      if (!user || isShadow || isDemoted()) {
        logRoomAction(db, joined.locationId, identityLabel(user, socket.id), "Attempted unauthorized room:initiate-vote. Rejected.");
        socket.emit("room:error", { error: "unauthorized", action: "room:initiate-vote" });
        return;
      }
      const { locationId, mode } = joined;
      const state = getTable(db, locationId, mode);
      if (state.status !== "break") {
        socket.emit("room:error", { error: "not_breaking", action: "room:initiate-vote" });
        return;
      }
      const tickets = listTickets(db, locationId, mode, cycleStartAtFor(state));
      if (user.id !== leaderUserId(tickets)) {
        socket.emit("room:error", { error: "not_leader", action: "room:initiate-vote" });
        return;
      }
      voteOpenedAt.set(tableKey(locationId, mode), Date.now());
      logRoomAction(db, locationId, identityLabel(user, socket.id), "Initiated the Rollover Vote.");
      broadcastRoom(io, db, locationId, mode);
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
    if (user) logSystemAction(db, locationId, identityLabel(user, socket.id), `Left ${mode}.`);
  }
  broadcastRoom(io, db, locationId, mode);
  broadcastLobby(io, db);
}
