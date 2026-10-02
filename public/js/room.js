const slug = window.location.pathname.split("/").pop();

const userBadge = document.getElementById("user-badge");
const roomNameEl = document.getElementById("room-name");
const timerEl = document.getElementById("timer");
const phaseLabelEl = document.getElementById("phase-label");
const startButton = document.getElementById("start-focus");
const resetButton = document.getElementById("reset-focus");
const presetsEl = document.getElementById("presets");
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

let currentTimer = { status: "idle", phaseEndAt: null, durationMs: null, startedByUsername: null };
let currentGoals = [];
let signedIn = false;
let myUsername = null;
let myId = null;
let myIsGuest = false;
let selectedMinutes = 25;
let presetMinutes = [15, 25, 45, 50];

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
    link.textContent = "log in to join";
    userBadge.appendChild(link);
  }
  updateControls();
}

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

socket.on("room:update", ({ timer, roster, upcoming, goals }) => {
  currentTimer = timer;
  renderRoster(roster);
  renderSchedule(upcoming ?? []);
  renderGoals(goals ?? []);
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
        : "On break";
  for (const input of presetsEl.querySelectorAll("input")) {
    input.disabled = !idle;
  }
  const canReset = signedIn && !idle && currentTimer.startedByUsername === myUsername;
  resetButton.hidden = !canReset;
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

function tick() {
  const { status, phaseEndAt, durationMs } = currentTimer;
  phaseLabelEl.textContent = status.toUpperCase();
  timerEl.className = `timer ${status}`;

  if (status === "idle" || phaseEndAt === null) {
    timerEl.textContent = format((selectedMinutes || 25) * 60 * 1000);
  } else {
    const remaining = Math.max(0, phaseEndAt - Date.now());
    timerEl.textContent = format(remaining);
  }
  requestAnimationFrame(tick);
}

function format(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

requestAnimationFrame(tick);
