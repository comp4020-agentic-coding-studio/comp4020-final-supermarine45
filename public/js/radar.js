const userBadge = document.getElementById("user-badge");
const locationsEl = document.getElementById("locations");

async function loadUser() {
  const res = await fetch("/api/me");
  const user = await res.json();
  userBadge.textContent = user ? `${user.username} · ${Math.round(user.focusMinutesTotal)} min` : "";
  if (!user) {
    const link = document.createElement("a");
    link.href = "/login";
    link.textContent = "log in";
    userBadge.appendChild(link);
  }
}

function render(locations) {
  locationsEl.innerHTML = "";
  for (const loc of locations) {
    const row = document.createElement("a");
    row.className = "location-row";
    row.href = `/room/${loc.slug}`;
    row.innerHTML = `
      <span class="name"><span class="dot ${loc.active ? "focus" : "idle"}"></span>${loc.name}</span>
      <span class="occupants">${loc.occupants} here</span>
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
