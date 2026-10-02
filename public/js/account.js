const infoEl = document.getElementById("account-info");
const dangerZoneEl = document.getElementById("danger-zone");
const deleteForm = document.getElementById("delete-form");
const deleteErrorEl = document.getElementById("delete-error");

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function load() {
  const res = await fetch("/api/me");
  const user = await res.json();
  if (!user) {
    window.location.href = "/login";
    return;
  }
  if (user.isGuest) {
    infoEl.innerHTML = `<p>${escapeHtml(user.username)} — anonymous guest. There's nothing to manage here, and nothing was saved.</p>`;
    dangerZoneEl.hidden = true;
    return;
  }
  infoEl.innerHTML = `
    <p><strong>Username</strong> ${escapeHtml(user.username)}</p>
    <p><strong>Email</strong> ${escapeHtml(user.email ?? "")}</p>
    <p><strong>All-time focus minutes</strong> ${Math.round(user.focusMinutesTotal)}</p>
  `;
}

deleteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  deleteErrorEl.textContent = "";
  const data = Object.fromEntries(new FormData(e.target));
  const res = await fetch("/auth/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (res.ok) {
    window.location.href = "/";
  } else {
    const body = await res.json().catch(() => ({}));
    deleteErrorEl.textContent = body.error ?? "could not delete account";
  }
});

load();
