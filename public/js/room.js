const slug = window.location.pathname.split("/").pop();

const userBadge = document.getElementById("user-badge");
const joinInButton = document.getElementById("join-in-btn");
const shadowNoteEl = document.getElementById("shadow-note");
const roomNameEl = document.getElementById("room-name");
const timerEl = document.getElementById("timer");
const phaseLabelEl = document.getElementById("phase-label");
const startButton = document.getElementById("start-focus");
const startLobbyButton = document.getElementById("start-lobby");
const sparkButton = document.getElementById("send-spark");
const timerRingEl = document.getElementById("timer-ring");
const resetButton = document.getElementById("reset-focus");
const presetsEl = document.getElementById("presets");
const lobbyBannerEl = document.getElementById("lobby-banner");
const lobbyTimeEl = document.getElementById("lobby-time");
const votePresetsEl = document.getElementById("vote-presets");
const rosterListEl = document.getElementById("roster-list");
const chatEl = document.getElementById("chat");
const chatLogEl = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const scheduleForm = document.getElementById("schedule-form");
const scheduleInput = document.getElementById("schedule-input");
const scheduleListEl = document.getElementById("schedule-list");
const scheduleErrorEl = document.getElementById("schedule-error");
const scheduleNoteEl = document.getElementById("schedule-note");
const goalFormEl = document.getElementById("goal-form");
const goalInputEl = document.getElementById("goal-input");
const goalListEl = document.getElementById("goal-list");
const reviewBannerEl = document.getElementById("review-banner");
const reviewUnfinishedEl = document.getElementById("review-unfinished");
const extendPresetsEl = document.getElementById("extend-presets");
const focusExtendEl = document.getElementById("focus-extend");

let currentTimer = { status: "idle", phaseEndAt: null, durationMs: null, startedByUsername: null };
let currentGoals = [];
let currentVotes = [];
let currentOccupants = 0;
let signedIn = false;
let myUsername = null;
let myId = null;
let myIsGuest = false;
let selectedMinutes = 25;
let presetMinutes = [15, 25, 45, 50];
const SPARK_COOLDOWN_MS = 10 * 1000;
let sparkCooldownUntil = 0;

async function loadUser() {
  const res = await fetch("/api/me");
  const user = await res.json();
  signedIn = Boolean(user);
  myUsername = signedIn ? user.username : null;
  myId = signedIn ? user.id : null;
  myIsGuest = signedIn ? Boolean(user.isGuest) : false;
  userBadge.innerHTML = "";
  if (signedIn && !myIsGuest) {
    const link = document.createElement("a");
    link.href = "/account";
    link.textContent = `${user.username} · ${Math.round(user.focusMinutesTotal)} min`;
    userBadge.appendChild(link);
  } else if (signedIn && myIsGuest) {
    userBadge.textContent = `${user.username} · guest`;
  } else {
    const link = document.createElement("a");
    link.href = "/login";
    link.textContent = "log in";
    userBadge.appendChild(link);
  }
  joinInButton.hidden = signedIn;
  shadowNoteEl.hidden = signedIn;
  updateControls();
}

// Mirrors the existing guest button in public/login.html exactly — a random
// adjective+animal name, no typed pseudonym. Deliberate: a guest name is
// never chosen, so it can never collide with or impersonate a real account.
joinInButton.addEventListener("click", async () => {
  await fetch("/auth/guest", { method: "POST" });
  window.location.reload();
});

async function loadPresets() {
  const res = await fetch("/api/config");
  const config = await res.json();
  presetMinutes = config.focusPresetsMin ?? [15, 25, 45, 50];
  selectedMinutes = presetMinutes.includes(25) ? 25 : presetMinutes[0];
  presetsEl.innerHTML = "";
  for (const minutes of presetMinutes) {
    const label = document.createElement("label");
    label.className = "preset";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "preset";
    input.value = String(minutes);
    input.checked = minutes === selectedMinutes;
    input.addEventListener("change", () => {
      selectedMinutes = minutes;
    });
    label.appendChild(input);
    label.append(`${minutes}m`);
    presetsEl.appendChild(label);
  }
}

async function loadInitialSchedule() {
  const res = await fetch(`/api/locations/${slug}/schedule`);
  if (!res.ok) return;
  const { sessions } = await res.json();
  renderSchedule(sessions ?? []);
}

fetch("/api/locations")
  .then((r) => r.json())
  .then((locations) => {
    const match = locations.find((l) => l.slug === slug);
    if (match) roomNameEl.textContent = match.name;
  });

loadUser();
loadPresets();
loadInitialSchedule();

const socket = io();
socket.on("connect", () => {
  socket.emit("room:join", { slug });
});

socket.on("room:update", ({ timer, roster, upcoming, goals, votes }) => {
  currentTimer = timer;
  currentVotes = votes ?? [];
  currentOccupants = roster.length;
  renderRoster(roster);
  renderSchedule(upcoming ?? []);
  renderGoals(goals ?? []);
  renderLobbyBanner();
  updateControls();
});

socket.on("chat:history", (messages) => {
  chatLogEl.innerHTML = "";
  for (const m of messages) appendChatMessage(m);
});

socket.on("chat:message", appendChatMessage);

socket.on("room:error", (message) => {
  roomNameEl.textContent = `Error: ${message}`;
});

socket.on("room:encouragement", ({ body }) => {
  showEncouragement(body);
});

// The server broadcasts this to everyone in the room, sender included, so
// everyone sees the identical encouraging line for a given spark — the text
// is chosen server-side, so there's no local copy to echo instantly on
// click the way a hardcoded string could be.
socket.on("focus_spark", ({ username, message }) => {
  triggerSparkRing();
  const who = username === myUsername ? "You" : username;
  showSpark(`${who} sent a spark — ${message}`);
});

socket.on("account:deleted", () => {
  window.location.href = "/login";
});

function showEncouragement(body) {
  const toast = document.createElement("div");
  toast.className = "encouragement";
  toast.textContent = body;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

function showSpark(text) {
  const toast = document.createElement("div");
  toast.className = "spark-toast";
  toast.textContent = `✨ ${text}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// Restarts the ripple even if one is already mid-animation: drop the class,
// force a reflow so the browser forgets the old animation ran, then re-add.
function triggerSparkRing() {
  timerRingEl.classList.remove("spark-pulse");
  void timerRingEl.offsetWidth;
  timerRingEl.classList.add("spark-pulse");
  setTimeout(() => timerRingEl.classList.remove("spark-pulse"), 2000);
}

function appendChatMessage(m) {
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = `<span class="who">${escapeHtml(m.username)}</span>${escapeHtml(m.body)}`;
  chatLogEl.appendChild(div);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderRoster(roster) {
  rosterListEl.innerHTML = "";
  for (const entry of roster) {
    const div = document.createElement("div");
    div.className = "roster-entry";
    const score = entry.isGuest
      ? `<span class="guest-tag">guest</span>`
      : `<span class="score">${Math.round(entry.focusMinutesTotal)}</span>`;
    div.innerHTML = `
      <span><span class="dot ${currentTimer.status}"></span>${escapeHtml(entry.username)}</span>
      ${score}
    `;
    rosterListEl.appendChild(div);
  }
}

function renderSchedule(upcoming) {
  scheduleListEl.innerHTML = "";
  const mine = upcoming.filter((e) => e.username === myUsername);
  const others = upcoming.filter((e) => e.username !== myUsername);
  if (mine.length === 0 && others.length === 0) {
    const p = document.createElement("p");
    p.className = "schedule-empty";
    p.textContent = "Nobody's planned a session here yet.";
    scheduleListEl.appendChild(p);
    return;
  }
  if (mine.length) {
    scheduleListEl.appendChild(scheduleGroupLabel("Yours"));
    for (const entry of mine) scheduleListEl.appendChild(scheduleRow(entry, true));
  }
  if (others.length) {
    scheduleListEl.appendChild(scheduleGroupLabel("Others"));
    for (const entry of others) scheduleListEl.appendChild(scheduleRow(entry, false));
  }
}

function scheduleGroupLabel(text) {
  const div = document.createElement("div");
  div.className = "schedule-group-label";
  div.textContent = text;
  return div;
}

function scheduleRow(entry, mine) {
  const div = document.createElement("div");
  div.className = "schedule-entry" + (mine ? " mine" : "");
  const when = new Date(entry.startsAt).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  });
  const span = document.createElement("span");
  span.textContent = mine ? when : `${when} — ${entry.username}`;
  div.appendChild(span);
  if (mine) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "schedule-delete";
    del.textContent = "✕";
    del.addEventListener("click", () => cancelSchedule(entry.id));
    div.appendChild(del);
  }
  return div;
}

async function cancelSchedule(id) {
  await fetch(`/api/schedule/${id}`, { method: "DELETE" });
}

function renderGoals(goals) {
  currentGoals = goals;
  const idle = currentTimer.status === "idle";
  goalListEl.innerHTML = "";
  for (const g of goals) {
    const div = document.createElement("div");
    div.className = "goal-item" + (g.done ? " done" : "");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = g.done;
    checkbox.disabled = !signedIn;
    checkbox.addEventListener("change", () => socket.emit("room:goal-toggle", { id: g.id }));
    const span = document.createElement("span");
    span.textContent = g.body;
    div.appendChild(checkbox);
    div.appendChild(span);
    if (idle && g.createdBy === myId) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "goal-delete";
      del.textContent = "✕";
      del.addEventListener("click", () => socket.emit("room:goal-delete", { id: g.id }));
      div.appendChild(del);
    }
    goalListEl.appendChild(div);
  }
  renderReviewBanner();
}

function renderReviewBanner() {
  const inReview = currentTimer.status === "review";
  reviewBannerEl.hidden = !inReview;
  if (!inReview) return;
  const unfinished = currentGoals.filter((g) => !g.done);
  reviewUnfinishedEl.innerHTML = "";
  for (const g of unfinished) {
    const div = document.createElement("div");
    div.className = "review-item";
    div.textContent = g.body;
    reviewUnfinishedEl.appendChild(div);
  }
  if (extendPresetsEl.childElementCount === 0) {
    for (const minutes of presetMinutes) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `+${minutes} min`;
      btn.disabled = !signedIn;
      btn.addEventListener("click", () => socket.emit("room:extend", { minutes }));
      extendPresetsEl.appendChild(btn);
    }
  }
}

function renderLobbyBanner() {
  const inLobby = currentTimer.status === "lobby";
  lobbyBannerEl.hidden = !inLobby;
  if (!inLobby) return;
  lobbyTimeEl.textContent = new Date(currentTimer.phaseEndAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  votePresetsEl.innerHTML = "";
  for (const minutes of presetMinutes) {
    const count = currentVotes.find((v) => v.minutes === minutes)?.count ?? 0;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${minutes}m (${count})`;
    btn.disabled = !signedIn;
    btn.addEventListener("click", () => socket.emit("room:vote", { minutes }));
    votePresetsEl.appendChild(btn);
  }
}

const RESET_LABELS = { focus: "Stop early", lobby: "Cancel vote", review: "Reset", break: "Reset" };

function renderFocusExtendPresets() {
  if (focusExtendEl.childElementCount > 0) return;
  for (const minutes of presetMinutes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `+${minutes} min`;
    btn.addEventListener("click", () => socket.emit("room:extend", { minutes }));
    focusExtendEl.appendChild(btn);
  }
}

function updateControls() {
  const locked = currentTimer.status === "focus";
  const idle = currentTimer.status === "idle";
  startButton.disabled = !signedIn || !idle;
  startButton.textContent = idle
    ? "Start Focus"
    : currentTimer.status === "focus"
      ? "Focus running"
      : currentTimer.status === "review"
        ? "Reviewing goals"
        : currentTimer.status === "lobby"
          ? "Vote in progress"
          : "On break";
  startLobbyButton.hidden = !idle || !signedIn || currentOccupants < 2;
  sparkButton.hidden = !locked || !signedIn;
  sparkButton.disabled = Date.now() < sparkCooldownUntil;
  focusExtendEl.hidden = !locked || !signedIn;
  if (locked && signedIn) renderFocusExtendPresets();
  for (const input of presetsEl.querySelectorAll("input")) {
    input.disabled = !idle;
  }
  const canReset = signedIn && !idle && currentTimer.startedByUsername === myUsername;
  resetButton.hidden = !canReset;
  resetButton.textContent = RESET_LABELS[currentTimer.status] ?? "Reset";
  chatInput.disabled = locked || !signedIn;
  chatForm.querySelector("button").disabled = locked || !signedIn;
  chatEl.classList.toggle("locked", locked);
  goalFormEl.hidden = !idle || !signedIn;
  for (const el of scheduleForm.querySelectorAll("input, button")) el.disabled = myIsGuest;
  scheduleNoteEl.hidden = !myIsGuest;
}

startButton.addEventListener("click", () => {
  socket.emit("room:start-focus", { minutes: selectedMinutes });
});

startLobbyButton.addEventListener("click", () => {
  socket.emit("room:start-lobby");
});

sparkButton.addEventListener("click", () => {
  if (Date.now() < sparkCooldownUntil) return;
  socket.emit("focus_spark");
  // Feedback (ripple + toast) arrives via the focus_spark listener above,
  // once the server broadcasts back — it picks the message, so there's
  // nothing to render here yet. Still disable immediately so a rapid
  // second click before that broadcast arrives doesn't queue a second emit.
  sparkCooldownUntil = Date.now() + SPARK_COOLDOWN_MS;
  updateControls();
  setTimeout(updateControls, SPARK_COOLDOWN_MS + 50);
});

resetButton.addEventListener("click", () => {
  socket.emit("room:reset");
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const body = chatInput.value.trim();
  if (!body) return;
  socket.emit("chat:send", { body });
  chatInput.value = "";
});

goalFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const body = goalInputEl.value.trim();
  if (!body) return;
  socket.emit("room:goal-add", { body });
  goalInputEl.value = "";
});

scheduleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  scheduleErrorEl.textContent = "";
  if (!scheduleInput.value) return;
  const startsAt = new Date(scheduleInput.value).getTime();
  const res = await fetch(`/api/locations/${slug}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startsAt }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    scheduleErrorEl.textContent = body.error ?? "could not plan that session";
    return;
  }
  scheduleInput.value = "";
  scheduleErrorEl.textContent = "Booked.";
  scheduleErrorEl.classList.add("ok");
  setTimeout(() => {
    scheduleErrorEl.textContent = "";
    scheduleErrorEl.classList.remove("ok");
  }, 3000);
});

// A flip clock in the classic split-flap sense: each digit is a card with a
// front/back face. set() writes the new character into whichever face is
// currently rotated away from the viewer, then advances a running flip
// counter to rotate the card — so the face that was hidden swings into view
// already showing the right digit. The rotateX value is simply left to keep
// incrementing across flips (no reset-without-transition hack needed; a
// session's worth of flips is a harmless CSS transform number).
class FlipDigit {
  constructor() {
    this.flipCount = 0;
    this.current = null;
    this.el = document.createElement("div");
    this.el.className = "flip-digit";
    this.inner = document.createElement("div");
    this.inner.className = "flip-card-inner";
    this.front = document.createElement("div");
    this.front.className = "flip-card-face flip-card-front";
    this.back = document.createElement("div");
    this.back.className = "flip-card-face flip-card-back";
    this.front.textContent = "0";
    this.back.textContent = "0";
    this.inner.append(this.front, this.back);
    this.el.appendChild(this.inner);
  }

  set(value) {
    if (value === this.current) return;
    const hiddenFace = this.flipCount % 2 === 0 ? this.back : this.front;
    hiddenFace.textContent = value;
    this.flipCount += 1;
    this.inner.style.transform = `rotateX(${this.flipCount * 180}deg)`;
    this.current = value;
  }
}

class FlipClock {
  constructor(mount) {
    this.minuteTens = new FlipDigit();
    this.minuteOnes = new FlipDigit();
    this.secondTens = new FlipDigit();
    this.secondOnes = new FlipDigit();
    const colon = document.createElement("div");
    colon.className = "flip-colon";
    colon.textContent = ":";
    mount.append(
      this.minuteTens.el,
      this.minuteOnes.el,
      colon,
      this.secondTens.el,
      this.secondOnes.el,
    );
  }

  setTime(minutes, seconds) {
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    this.minuteTens.set(mm[0]);
    this.minuteOnes.set(mm[1]);
    this.secondTens.set(ss[0]);
    this.secondOnes.set(ss[1]);
  }
}

const flipClock = new FlipClock(timerEl);

function tick() {
  const { status, phaseEndAt, durationMs } = currentTimer;
  phaseLabelEl.textContent = status.toUpperCase();
  timerEl.className = `timer ${status}`;

  const remainingMs =
    status === "idle" || phaseEndAt === null
      ? (selectedMinutes || 25) * 60 * 1000
      : Math.max(0, phaseEndAt - Date.now());
  const totalSeconds = Math.ceil(remainingMs / 1000);
  flipClock.setTime(Math.floor(totalSeconds / 60), totalSeconds % 60);
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
