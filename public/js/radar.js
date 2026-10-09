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

// Which buildings are expanded, keyed by buildingSlug. render() rebuilds the
// whole list on every lobby:update (someone, somewhere, changing timer
// status), so this has to live outside render() — otherwise an accordion a
// user opened would snap shut because of an unrelated action in another
// building. Seeded lazily: the first render opens every building so the
// "comprehensive list" is actually visible without extra clicks.
let openBuildings = null;

function locationRow(loc) {
  const row = document.createElement("a");
  row.className = "location-row";
  row.href = `/room/${loc.slug}`;
  const badge = loc.upcomingCount ? `<span class="planned-badge">${loc.upcomingCount} planned</span>` : "";
  row.innerHTML = `
    <span class="name"><span class="dot ${loc.active ? "focus" : "idle"}"></span>${loc.name}</span>
    <span class="meta">${badge}<span class="occupants">${loc.occupants} here</span></span>
  `;
  return row;
}

function groupByBuilding(locations) {
  const buildings = new Map();
  for (const loc of locations) {
    if (!buildings.has(loc.buildingSlug)) {
      buildings.set(loc.buildingSlug, { slug: loc.buildingSlug, name: loc.buildingName, spaces: [] });
    }
    buildings.get(loc.buildingSlug).spaces.push(loc);
  }
  return [...buildings.values()];
}

function render(locations) {
  const buildings = groupByBuilding(locations);
  if (openBuildings === null) {
    openBuildings = new Set(buildings.map((b) => b.slug));
  }
  locationsEl.innerHTML = "";
  for (const building of buildings) {
    const occupants = building.spaces.reduce((sum, s) => sum + s.occupants, 0);
    const active = building.spaces.some((s) => s.active);
    const details = document.createElement("details");
    details.className = "building";
    details.open = openBuildings.has(building.slug);
    details.addEventListener("toggle", () => {
      if (details.open) openBuildings.add(building.slug);
      else openBuildings.delete(building.slug);
    });
    const summary = document.createElement("summary");
    summary.className = "building-summary";
    summary.innerHTML = `
      <span class="name"><span class="dot ${active ? "focus" : "idle"}"></span>${building.name}</span>
      <span class="meta"><span class="occupants">${occupants} here</span></span>
    `;
    details.appendChild(summary);
    const spacesEl = document.createElement("div");
    spacesEl.className = "building-spaces";
    for (const loc of building.spaces) spacesEl.appendChild(locationRow(loc));
    details.appendChild(spacesEl);
    locationsEl.appendChild(details);
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
