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

let currentTimer = { status: "idle", phaseEndAt: null, durationMs: null, startedByUsername: null };
let signedIn = false;
let myUsername = null;
let selectedMinutes = 25;

async function loadUser() {
  const res = await fetch("/api/me");
  const user = await res.json();
  signedIn = Boolean(user);
  myUsername = signedIn ? user.username : null;
  userBadge.textContent = signedIn ? `${user.username} · ${Math.round(user.focusMinutesTotal)} min` : "";
  if (!signedIn) {
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
  const presets = config.focusPresetsMin ?? [15, 25, 45, 50];
  selectedMinutes = presets.includes(25) ? 25 : presets[0];
  presetsEl.innerHTML = "";
  for (const minutes of presets) {
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

fetch("/api/locations")
  .then((r) => r.json())
  .then((locations) => {
    const match = locations.find((l) => l.slug === slug);
    if (match) roomNameEl.textContent = match.name;
  });

loadUser();
loadPresets();

const socket = io();
socket.on("connect", () => {
  socket.emit("room:join", { slug });
});

socket.on("room:update", ({ timer, roster, upcoming }) => {
  currentTimer = timer;
  renderRoster(roster);
  renderSchedule(upcoming ?? []);
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
    div.innerHTML = `
      <span><span class="dot ${currentTimer.status}"></span>${escapeHtml(entry.username)}</span>
      <span class="score">${Math.round(entry.focusMinutesTotal)}</span>
    `;
    rosterListEl.appendChild(div);
  }
}

function renderSchedule(upcoming) {
  scheduleListEl.innerHTML = "";
  for (const entry of upcoming) {
    const div = document.createElement("div");
    div.className = "schedule-entry";
    const when = new Date(entry.startsAt).toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
    const span = document.createElement("span");
    span.textContent = `${when} — ${entry.username}`;
    div.appendChild(span);
    if (entry.username === myUsername) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "schedule-delete";
      del.textContent = "✕";
      del.addEventListener("click", () => cancelSchedule(entry.id));
      div.appendChild(del);
    }
    scheduleListEl.appendChild(div);
  }
}

async function cancelSchedule(id) {
  await fetch(`/api/schedule/${id}`, { method: "DELETE" });
}

function updateControls() {
  const locked = currentTimer.status === "focus";
  const idle = currentTimer.status === "idle";
  startButton.disabled = !signedIn || !idle;
  startButton.textContent = idle ? "Start Focus" : "Focus running";
  for (const input of presetsEl.querySelectorAll("input")) {
    input.disabled = !idle;
  }
  const canReset = signedIn && !idle && currentTimer.startedByUsername === myUsername;
  resetButton.hidden = !canReset;
  chatInput.disabled = locked || !signedIn;
  chatForm.querySelector("button").disabled = locked || !signedIn;
  chatEl.classList.toggle("locked", locked);
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

scheduleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!scheduleInput.value) return;
  const startsAt = new Date(scheduleInput.value).getTime();
  await fetch(`/api/locations/${slug}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startsAt }),
  });
  scheduleInput.value = "";
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
