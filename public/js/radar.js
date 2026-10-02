const userBadge = document.getElementById("user-badge");
const locationsEl = document.getElementById("locations");
const upcomingPanelEl = document.getElementById("upcoming-panel");
const upcomingListEl = document.getElementById("upcoming-list");

async function loadUser() {
  const res = await fetch("/api/me");
  const user = await res.json();
  userBadge.innerHTML = "";
  if (!user) {
    const link = document.createElement("a");
    link.href = "/login";
    link.textContent = "log in";
    userBadge.appendChild(link);
    return;
  }
  if (user.isGuest) {
    userBadge.textContent = `${user.username} · guest`;
    return;
  }
  const link = document.createElement("a");
  link.href = "/account";
  link.textContent = `${user.username} · ${Math.round(user.focusMinutesTotal)} min`;
  userBadge.appendChild(link);
  loadUpcoming();
}

async function loadUpcoming() {
  const res = await fetch("/api/me/schedule");
  if (!res.ok) return;
  const { sessions } = await res.json();
  upcomingPanelEl.hidden = sessions.length === 0;
  upcomingListEl.innerHTML = "";
  for (const s of sessions) {
    const when = new Date(s.startsAt).toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
    const div = document.createElement("div");
    div.className = "schedule-entry";
    const span = document.createElement("span");
    span.textContent = `${s.locationName} — ${when}`;
    div.appendChild(span);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "schedule-delete";
    del.textContent = "✕";
    del.addEventListener("click", async () => {
      await fetch(`/api/schedule/${s.id}`, { method: "DELETE" });
      loadUpcoming();
    });
    div.appendChild(del);
    upcomingListEl.appendChild(div);
  }
}

function render(locations) {
  locationsEl.innerHTML = "";
  for (const loc of locations) {
    const row = document.createElement("a");
    row.className = "location-row";
    row.href = `/room/${loc.slug}`;
    const badge = loc.upcomingCount ? `<span class="planned-badge">${loc.upcomingCount} planned</span>` : "";
    row.innerHTML = `
      <span class="name"><span class="dot ${loc.active ? "focus" : "idle"}"></span>${loc.name}</span>
      <span class="meta">${badge}<span class="occupants">${loc.occupants} here</span></span>
    `;
    locationsEl.appendChild(row);
  }
}

loadUser();

fetch("/api/locations")
  .then((r) => r.json())
  .then((locations) => render(locations.map((l) => ({ ...l, occupants: 0, active: false }))));

const socket = io();
socket.on("lobby:update", render);
socket.on("account:deleted", () => {
  window.location.href = "/login";
});
