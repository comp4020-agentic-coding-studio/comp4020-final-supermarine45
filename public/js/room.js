const slug = window.location.pathname.split("/").pop();

const userBadge = document.getElementById("user-badge");
const roomNameEl = document.getElementById("room-name");
const timerEl = document.getElementById("timer");
const phaseLabelEl = document.getElementById("phase-label");
const startButton = document.getElementById("start-focus");
const rosterListEl = document.getElementById("roster-list");
const chatEl = document.getElementById("chat");
const chatLogEl = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

let currentTimer = { status: "idle", phaseEndAt: null, durationMs: null };
let signedIn = false;

async function loadUser() {
  const res = await fetch("/api/me");
  const user = await res.json();
  signedIn = Boolean(user);
  userBadge.textContent = signedIn ? `${user.username} · ${Math.round(user.focusMinutesTotal)} min` : "";
  if (!signedIn) {
    const link = document.createElement("a");
    link.href = "/login";
    link.textContent = "log in to join";
    userBadge.appendChild(link);
  }
  updateControls();
}

fetch("/api/locations")
  .then((r) => r.json())
  .then((locations) => {
    const match = locations.find((l) => l.slug === slug);
    if (match) roomNameEl.textContent = match.name;
  });

loadUser();

const socket = io();
socket.on("connect", () => {
  socket.emit("room:join", { slug });
});

socket.on("room:update", ({ timer, roster }) => {
  currentTimer = timer;
  renderRoster(roster);
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

function updateControls() {
  const locked = currentTimer.status === "focus";
  startButton.disabled = !signedIn || currentTimer.status !== "idle";
  startButton.textContent = currentTimer.status === "idle" ? "Start Focus" : "Focus running";
  chatInput.disabled = locked || !signedIn;
  chatForm.querySelector("button").disabled = locked || !signedIn;
  chatEl.classList.toggle("locked", locked);
}

startButton.addEventListener("click", () => {
  socket.emit("room:start-focus");
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const body = chatInput.value.trim();
  if (!body) return;
  socket.emit("chat:send", { body });
  chatInput.value = "";
});

function tick() {
  const { status, phaseEndAt, durationMs } = currentTimer;
  phaseLabelEl.textContent = status.toUpperCase();
  timerEl.className = `timer ${status}`;

  if (status === "idle" || phaseEndAt === null) {
    timerEl.textContent = format(durationMs ?? 25 * 60 * 1000);
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
