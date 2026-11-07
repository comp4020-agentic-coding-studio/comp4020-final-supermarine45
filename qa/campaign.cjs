#!/usr/bin/env node
// Manual QA campaign driver (user-requested, run 2026-11-06) against the real,
// persistent server on :8080 (real data/app.db, real 60-minute TABLE_CYCLE_MS
// — NOT the spec/e2e disposable test-speed servers). This intentionally
// writes real, permanent rows: accounts, tickets, streaks, VFH, kudos, etc.
// are left in the database afterward for manual inspection, per the request.
//
// Unlike spec/ and e2e/, this is not a pass/fail test suite checked into the
// repo's own `pnpm check` — it's a one-off, long-running exercise script. It
// logs structured JSON lines to stdout (redirected to qa/campaign.log by the
// caller) so progress can be tailed/grepped without re-reading full output.
//
// Usage: node qa/campaign.cjs [rounds]   (default rounds=8, one real ~60min
// cycle each => ~8 hours; each round picks a different (building, mode) pair).

const BASE_URL = process.env.QA_BASE_URL || "http://localhost:8080";
const { io } = require("socket.io-client");

function log(event, data = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function untilRoomUpdate(socket, predicate) {
  return new Promise((resolve) => {
    function handler(payload) {
      if (predicate(payload)) {
        socket.off("room:update", handler);
        resolve(payload);
      }
    }
    socket.on("room:update", handler);
  });
}
function untilStatus(socket, status) {
  return untilRoomUpdate(socket, (p) => p.timer.status === status);
}
// Whiteboard (Problem-Solving) and Peer Review (Writing Clinic) only open at
// the solo->collab split (40 real minutes into the 50-minute focus block) —
// confirmed via src/rooms.ts's whiteboardSubphaseOk/peerReviewSubphaseOk,
// which gate on computeSubphase(...) === "collab", not merely status ===
// "focus". Calling those handlers right after reaching "focus" would get
// rejected with wrong_mode for the first 40 minutes of every cycle.
function untilCollabSubphase(socket) {
  return untilRoomUpdate(socket, (p) => p.timer.status === "focus" && p.timer.subphase === "collab");
}
function untilTicketCount(socket, count) {
  return untilRoomUpdate(socket, (p) => p.tickets.length === count);
}
// Robust against a table that already has stray/leftover tickets for the
// current cycle (e.g. a manual smoke test that happened to board at the same
// (slug, mode) in the same 5-minute cycle-start window) — waits for each of
// *this round's own* boarders to show up by userId, rather than an absolute
// count that a pre-existing extra ticket would make impossible to hit.
function untilAllBoarded(socket, userIds) {
  return untilRoomUpdate(socket, (p) => userIds.every((id) => p.tickets.some((t) => t.userId === id)));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function postJson(path, body, cookie) {
  const res = await fetch(new URL(path, BASE_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // no body
  }
  return { status: res.status, body: json };
}

async function deleteJson(path, body, cookie) {
  const res = await fetch(new URL(path, BASE_URL), {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // no body
  }
  return { status: res.status, body: json };
}

async function getJson(path, cookie) {
  const res = await fetch(new URL(path, BASE_URL), { headers: cookie ? { cookie } : {} });
  return { status: res.status, body: await res.json() };
}

async function registerAccount(username, password) {
  const email = `${username}@anu.edu.au`;
  const { status, body } = await postJson("/auth/register", { username, email, password });
  if (status !== 201) throw new Error(`register ${username} failed (${status}): ${JSON.stringify(body)}`);
  return { username, email, password };
}

async function loginCookie(username, password) {
  const res = await fetch(new URL("/auth/login", BASE_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (res.status !== 200) throw new Error(`login ${username} failed (${res.status}): ${JSON.stringify(body)}`);
  const setCookie = res.headers.get("set-cookie");
  return setCookie.split(";")[0];
}

// Item 1's "anonymous users": a Guest (POST /auth/guest) is this app's real
// "anonymous participant" identity — it gets a random name, a cookie, and
// can fully participate (board/pivot/stamp/whiteboard/etc.), but leaves zero
// DB footprint and is permanently excluded from every /api/me/* stats route
// (requireRealUser). A true Shadow (no cookie at all) is the *unregistered
// viewer* identity and is blocked from every mutating action by design
// (isShadow guard) — it is exercised separately below as the "attempted
// pivot while truly anonymous should be rejected" negative check, since a
// bare Shadow has no credential worth reporting back to the user.
async function guestCookie() {
  const res = await fetch(new URL("/auth/guest", BASE_URL), { method: "POST" });
  const body = await res.json();
  if (res.status !== 201) throw new Error(`guest create failed (${res.status}): ${JSON.stringify(body)}`);
  const setCookie = res.headers.get("set-cookie");
  return { cookie: setCookie.split(";")[0], username: body.username };
}

function connectSocket(cookie) {
  return io(BASE_URL, { extraHeaders: cookie ? { cookie } : {}, transports: ["websocket"] });
}

// -----------------------------------------------------------------------
// Account setup (item 1): 3 registered users, 2 anonymous Guests, plus 1
// registered user earmarked purely for the deletion test at the very end.
// -----------------------------------------------------------------------
async function setupAccounts() {
  const stamp = Date.now().toString(36);
  const users = [
    { username: `qa-alice-${stamp}`, password: "Password123!" },
    { username: `qa-bob-${stamp}`, password: "Password123!" },
    { username: `qa-carol-${stamp}`, password: "Password123!" },
  ];
  const deletionUser = { username: `qa-deleteme-${stamp}`, password: "Password123!" };

  for (const u of [...users, deletionUser]) {
    await registerAccount(u.username, u.password);
    log("account_created", { username: u.username, password: u.password });
  }

  const cookies = {};
  for (const u of users) cookies[u.username] = await loginCookie(u.username, u.password);
  const deletionCookie = await loginCookie(deletionUser.username, deletionUser.password);

  const guestA = await guestCookie();
  log("anonymous_guest_created", { username: guestA.username, note: "anonymous participant #1 (Guest identity, no password — ephemeral, re-create via POST /auth/guest if needed)" });
  const guestB = await guestCookie();
  log("anonymous_guest_created", { username: guestB.username, note: "anonymous participant #2 (Guest identity, no password — ephemeral, re-create via POST /auth/guest if needed)" });

  return { users, deletionUser, deletionCookie, cookies, guestA, guestB };
}

// -----------------------------------------------------------------------
// One full round at one (slug, mode) table: boards N members (some
// registered, one Guest, one true Shadow observer), drives the whole cycle
// (idle -> focus(solo) -> focus(collab, mode-specific mechanic) -> break ->
// idle), exercising stamps/kudos/pivot/toggle-stuck as applicable, then
// reads back stats to confirm persistence.
// -----------------------------------------------------------------------
async function runRound({ slug, mode, members, cycleMs, roundLabel }) {
  log("round_start", { roundLabel, slug, mode, memberCount: members.length });

  const sockets = members.map((m) => ({ ...m, socket: connectSocket(m.cookie) }));
  for (const m of sockets) {
    // Checked in honestly on every ping, exactly like every spec/e2e scenario
    // — real CHECKIN_GRACE_MS is 2 minutes; missing this demotes the member
    // and silently corrupts the rest of the round.
    m.socket.on("room:checkin-request", () => m.socket.emit("room:checkin-confirm"));
  }

  try {
    await Promise.all(sockets.map((m) => once(m.socket, "connect")));
    log("round_connected", { roundLabel });

    for (const m of sockets) m.socket.emit("room:join", { slug, mode });
    const joined = await Promise.all(sockets.map((m) => once(m.socket, "room:joined")));
    for (let i = 0; i < sockets.length; i++) {
      log("member_joined", { roundLabel, member: sockets[i].label, isShadow: joined[i].isShadow });
    }

    const observer = sockets.find((m) => !m.isShadowObserver) || sockets[0];
    const boarders = sockets.filter((m) => m.board && m.userId);
    if (boarders.length > 0) {
      const seesAll = untilAllBoarded(observer.socket, boarders.map((m) => m.userId));
      for (const m of boarders) {
        const payload = { body: m.ticketBody };
        if (m.personalDurationMinutes) payload.personalDurationMinutes = m.personalDurationMinutes;
        m.socket.emit("room:submit-ticket", payload);
      }
      await withTimeout(seesAll, 20000, `${roundLabel}: all ${boarders.length} of this round's tickets to board`);
      log("tickets_boarded", { roundLabel, count: boarders.length, bodies: boarders.map((m) => m.ticketBody) });
    }

    // Idle tables only start on the next 5-minute wall-clock mark
    // (CYCLE_START_GRANULARITY_MS), so this can take up to 5 real minutes on
    // top of the cycle length itself.
    await withTimeout(untilStatus(observer.socket, "focus"), cycleMs + 6 * 60 * 1000, `${roundLabel}: table to reach focus`);
    log("phase_focus_solo", { roundLabel });

    // Goal pivot test (item 4), mid-focus, during the solo subphase (pivot
    // only requires status === "focus", not collab) — one boarder pivots; a
    // true Shadow attempts the same action and must be rejected by design.
    const pivoter = boarders.find((m) => m.pivotAfterFocus);
    const shadowPivotAttempt = sockets.find((m) => m.attemptPivotAsShadow);

    if (shadowPivotAttempt) {
      const rejection = once(shadowPivotAttempt.socket, "room:error");
      shadowPivotAttempt.socket.emit("room:pivot-ticket", { body: "Attempted pivot as true anonymous Shadow" });
      const err = await withTimeout(rejection, 8000, `${roundLabel}: shadow pivot rejection`);
      log("shadow_pivot_rejected_as_expected", { roundLabel, error: err });
    }

    if (pivoter) {
      const pivotSeen = untilRoomUpdate(observer.socket, (p) => {
        const t = p.tickets.find((t) => t.userId === pivoter.userId);
        return !!t && t.pivotedAt !== null;
      });
      pivoter.socket.emit("room:pivot-ticket", { body: pivoter.pivotBody });
      await withTimeout(pivotSeen, 10000, `${roundLabel}: pivot to land`);
      log("ticket_pivoted", { roundLabel, member: pivoter.label, newBody: pivoter.pivotBody });
    }

    // Mode-specific collab mechanic (item 5: discussion/whiteboards/swaps) —
    // only reachable once the table has crossed into the collab subphase.
    if (mode === "problem" || mode === "writing") {
      await withTimeout(untilCollabSubphase(observer.socket), cycleMs, `${roundLabel}: table to reach collab subphase`);
      log("phase_focus_collab", { roundLabel, mode });

      if (mode === "problem") {
        const stucker = boarders[0];
        if (stucker) {
          const stuckSeen = untilRoomUpdate(observer.socket, (p) => {
            const t = p.tickets.find((t) => t.userId === stucker.userId);
            return !!t && t.stuck === true;
          });
          stucker.socket.emit("room:toggle-stuck");
          await withTimeout(stuckSeen, 15000, `${roundLabel}: toggle-stuck to land`).catch((e) => log("toggle_stuck_not_confirmed", { roundLabel, detail: String(e) }));
          log("toggle_stuck_attempted", { roundLabel, member: stucker.label });
        }
        const launcher = boarders[0];
        if (launcher) {
          const wbSeen = untilRoomUpdate(observer.socket, (p) => p.whiteboardOpenedAt !== null);
          launcher.socket.emit("room:launch-whiteboard");
          await withTimeout(wbSeen, 15000, `${roundLabel}: whiteboard to open`).catch((e) => log("whiteboard_launch_not_confirmed", { roundLabel, detail: String(e) }));
          launcher.socket.emit("room:whiteboard-paste", { text: `QA scratch text for ${roundLabel}` });
          if (boarders.length > 1) launcher.socket.emit("room:whiteboard-highlight", { start: 0, end: 5 });
          log("whiteboard_exercised", { roundLabel, member: launcher.label });
        }
      } else if (mode === "writing") {
        // Writing Clinic: peer-review draft swap ("swaps"). Needs >=2
        // drafters for recomputePeerReviewAssignments to assign anyone.
        const drafters = boarders.slice(0, Math.min(3, boarders.length));
        if (drafters.length >= 2) {
          const assigned = Promise.all(drafters.map((m) => once(m.socket, "room:peer-review-assignment")));
          for (const m of drafters) m.socket.emit("room:submit-draft", { text: `Draft from ${m.label} for ${roundLabel}.` });
          await withTimeout(assigned, 15000, `${roundLabel}: peer review assignments`).catch((e) => log("peer_review_assignment_not_confirmed", { roundLabel, detail: String(e) }));
          log("peer_review_drafts_submitted", { roundLabel, drafters: drafters.map((m) => m.label) });
        }
      }
    } else if (mode === "pitch") {
      // Concept Pitch — closest analog to "discussion" (item 5): solo prep
      // then verbal explanation. No extra server mechanic beyond the shared
      // collab subphase flag itself (confirmed via grep: no pitch-specific
      // socket handlers exist), so there is nothing further to drive here.
      await withTimeout(untilCollabSubphase(observer.socket), cycleMs, `${roundLabel}: table to reach collab (discussion) subphase`);
      log("phase_discussion_collab", { roundLabel, note: "Concept Pitch has no extra server mechanic beyond the shared collab subphase" });
    } else {
      log("phase_silent_no_collab", { roundLabel, note: "Silent Focus has splitMinutes: null, no collab subphase by design" });
    }

    // Kudos during break.
    await withTimeout(untilStatus(observer.socket, "break"), cycleMs + 6 * 60 * 1000, `${roundLabel}: table to reach break`);
    log("phase_break", { roundLabel });

    for (const m of boarders) m.socket.emit("room:stamp-ticket", { stamp: m.stamp || "completed" });
    log("tickets_stamped", { roundLabel, members: boarders.map((m) => m.label), stamps: boarders.map((m) => m.stamp || "completed") });

    if (boarders.length >= 2 && boarders[1].userId) {
      boarders[0].socket.emit("room:send-kudos", { toUserId: boarders[1].userId, emoji: "⚡" });
      log("kudos_sent", { roundLabel, from: boarders[0].label, to: boarders[1].label });
    }

    await withTimeout(untilStatus(observer.socket, "idle"), cycleMs + 6 * 60 * 1000, `${roundLabel}: table to return to idle`);
    log("round_complete", { roundLabel, slug, mode });
  } catch (err) {
    log("round_error", { roundLabel, slug, mode, error: String(err && err.stack ? err.stack : err) });
  } finally {
    for (const m of sockets) m.socket.disconnect();
  }
}

async function logMemberStats(username, cookie) {
  const [me, history, streaks, diet, hubStats] = await Promise.all([
    getJson("/api/me", cookie),
    getJson("/api/me/history?limit=10", cookie),
    getJson("/api/me/streaks", cookie),
    getJson("/api/me/diet", cookie),
    getJson("/api/me/hub-stats", cookie),
  ]);
  log("member_stats_snapshot", {
    username,
    vfhCount: me.body.vfhCount,
    historyCount: history.body.history ? history.body.history.length : null,
    recentHistory: history.body.history ? history.body.history.slice(0, 3) : null,
    streaks: streaks.body.streaks,
    diet: diet.body.modes,
    hubStats: hubStats.body.hubs,
  });
}

async function main() {
  const rounds = Number(process.argv[2]) || 8;
  log("campaign_start", { baseUrl: BASE_URL, rounds });

  const config = await getJson("/api/config", null);
  log("server_config", config.body);

  const accounts = await setupAccounts();
  const { users, cookies, guestA, guestB } = accounts;

  // Two buildings per item 2 — Chifley Library and Hancock Library each have
  // multiple distinct slugs, so back-to-back rounds use a fresh table rather
  // than racing the previous round's cycle on the same table.
  const buildingSlugs = {
    chifley: ["chifley-ground", "chifley-l1", "chifley-l2", "chifley-l3"],
    hancock: ["hancock-ground", "hancock-l1", "hancock-l2"],
  };
  const modes = ["silent", "writing", "pitch", "problem"];
  const cycleMs = 60 * 60 * 1000; // real TABLE_CYCLE_MS default (src/rooms.ts)

  for (let i = 0; i < rounds; i++) {
    const buildingKey = i % 2 === 0 ? "chifley" : "hancock";
    const slugs = buildingSlugs[buildingKey];
    const slug = slugs[i % slugs.length];
    const mode = modes[i % modes.length];
    const roundLabel = `round-${i + 1}-${buildingKey}-${slug}-${mode}`;

    const [meA, meB, meC, meGuestA, meGuestB] = await Promise.all([
      getJson("/api/me", cookies[users[0].username]),
      getJson("/api/me", cookies[users[1].username]),
      getJson("/api/me", cookies[users[2].username]),
      getJson("/api/me", guestA.cookie),
      getJson("/api/me", guestB.cookie),
    ]);

    const members = [
      {
        label: users[0].username,
        cookie: cookies[users[0].username],
        userId: meA.body.id,
        board: true,
        ticketBody: `Round ${i + 1}: read the assigned chapter`,
        pivotAfterFocus: i === 0, // exercise pivot-as-registered-user once early
        pivotBody: `Round ${i + 1}: switched to summarizing instead`,
        personalDurationMinutes: i === 1 ? 25 : undefined, // exercise personal duration once
        stamp: "completed",
      },
      {
        label: users[1].username,
        cookie: cookies[users[1].username],
        userId: meB.body.id,
        board: true,
        ticketBody: `Round ${i + 1}: outline the response`,
        stamp: i % 3 === 0 ? "partial" : "completed",
      },
      {
        label: users[2].username,
        cookie: cookies[users[2].username],
        userId: meC.body.id,
        board: mode === "writing" || mode === "problem",
        ticketBody: `Round ${i + 1}: draft the summary`,
        stamp: "completed",
      },
      {
        label: `${guestA.username} (Guest/anonymous #1)`,
        cookie: guestA.cookie,
        userId: meGuestA.body.id,
        board: true,
        ticketBody: `Round ${i + 1}: anonymous participant goal`,
        pivotAfterFocus: i === 2, // exercise pivot-as-guest once (item 4, "anonymous" participant)
        pivotBody: `Round ${i + 1}: anonymous participant switched goal`,
        stamp: "completed",
      },
      {
        label: `${guestB.username} (Guest/anonymous #2, view-only)`,
        cookie: guestB.cookie,
        userId: meGuestB.body.id,
        board: false,
      },
      {
        label: "true-shadow-observer (no identity at all)",
        cookie: null,
        board: false,
        isShadowObserver: true,
        attemptPivotAsShadow: i === 3, // confirm a never-pseudonymed viewer's pivot is rejected (design check)
      },
    ];

    await runRound({ slug, mode, members, cycleMs, roundLabel });

    for (const u of users) {
      await logMemberStats(u.username, cookies[u.username]).catch((e) => log("stats_snapshot_error", { username: u.username, error: String(e) }));
    }

    const locStats = await getJson(`/api/locations/${slug}/stats`, null).catch((e) => ({ body: { error: String(e) } }));
    log("location_stats_snapshot", { slug, stats: locStats.body });

    log("round_checkpoint", { completedRounds: i + 1, totalRounds: rounds });
  }

  // Account deletion test (item 1's "one user account to test for
  // deletion"): re-confirm password, delete, then confirm a subsequent login
  // fails.
  const delUser = accounts.deletionUser;
  const delResult = await deleteJson("/auth/account", { password: delUser.password }, accounts.deletionCookie);
  log("account_deletion_attempted", { username: delUser.username, status: delResult.status, body: delResult.body });
  const loginAfterDelete = await fetch(new URL("/auth/login", BASE_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: delUser.username, password: delUser.password }),
  });
  log("account_deletion_verified", { username: delUser.username, loginStatusAfterDelete: loginAfterDelete.status, expectRejected: loginAfterDelete.status !== 200 });

  log("campaign_complete", { rounds });
}

main().catch((err) => {
  log("campaign_fatal_error", { error: String(err && err.stack ? err.stack : err) });
  process.exitCode = 1;
});
