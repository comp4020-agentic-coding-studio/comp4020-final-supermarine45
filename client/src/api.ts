import type {
  ActivityModeInfo,
  Buddy,
  BuddyFeedEntry,
  CognitiveDietEntry,
  HeatmapEntry,
  HubStatsEntry,
  LobbyLocation,
  LocationHistoryEntry,
  LocationStats,
  Me,
  ScheduledSession,
  StreakEntry,
  UpcomingSessionForUser,
  UserHistoryEntry,
} from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export function getMe(): Promise<Me | null> {
  return getJson<Me | null>("/api/me");
}

export interface LocationSummary {
  id: number;
  slug: string;
  name: string;
  buildingSlug: string;
  buildingName: string;
  upcomingCount: number;
}

export function getLocations(): Promise<LocationSummary[]> {
  return getJson<LocationSummary[]>("/api/locations");
}

export function getConfig(): Promise<{ activityModes: ActivityModeInfo[] }> {
  return getJson("/api/config");
}

export function getHeatmap(days = 365): Promise<{ days: HeatmapEntry[] }> {
  return getJson(`/api/me/heatmap?days=${days}`);
}

export function getDiet(): Promise<{ modes: CognitiveDietEntry[] }> {
  return getJson("/api/me/diet");
}

export function getHubStats(): Promise<{ hubs: HubStatsEntry[] }> {
  return getJson("/api/me/hub-stats");
}

export function getStreaks(): Promise<{ streaks: StreakEntry[] }> {
  return getJson("/api/me/streaks");
}

export function getHistory(limit = 20): Promise<{ history: UserHistoryEntry[] }> {
  return getJson(`/api/me/history?limit=${limit}`);
}

export function getLocationHistory(slug: string, limit = 20): Promise<{ history: LocationHistoryEntry[] }> {
  return getJson(`/api/locations/${slug}/history?limit=${limit}`);
}

export function getLocationStats(slug: string): Promise<LocationStats> {
  return getJson(`/api/locations/${slug}/stats`);
}

export function getBuddies(): Promise<{ buddies: Buddy[] }> {
  return getJson("/api/me/buddies");
}

export function getBuddyFeed(limit = 20): Promise<{ feed: BuddyFeedEntry[] }> {
  return getJson(`/api/me/buddy-feed?limit=${limit}`);
}

export function getMySchedule(): Promise<{ sessions: UpcomingSessionForUser[] }> {
  return getJson("/api/me/schedule");
}

export async function setChimePref(chimeEnabled: boolean): Promise<void> {
  await fetch("/api/me/prefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chimeEnabled }),
  });
}

export async function requestBuddy(addresseeId: number): Promise<{ ok: true } | { error: string }> {
  const res = await fetch("/api/buddies/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresseeId }),
  });
  return res.json();
}

export async function acceptBuddy(requesterId: number): Promise<{ ok: true } | { error: string }> {
  const res = await fetch(`/api/buddies/${requesterId}/accept`, { method: "POST" });
  return res.json();
}

export async function cancelSchedule(id: number): Promise<void> {
  await fetch(`/api/schedule/${id}`, { method: "DELETE" });
}

export async function planSession(slug: string, startsAt: number): Promise<{ ok: boolean } | { error: string }> {
  const res = await fetch(`/api/locations/${slug}/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startsAt }),
  });
  return res.json();
}

export function getLocationSchedule(slug: string): Promise<{ sessions: ScheduledSession[] }> {
  return getJson(`/api/locations/${slug}/schedule`);
}

export async function registerAccount(
  username: string,
  email: string,
  password: string,
): Promise<{ ok: true } | { error: string }> {
  const res = await fetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password }),
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  return { error: body.error ?? "could not register" };
}

export async function loginAccount(
  username: string,
  password: string,
): Promise<{ ok: true } | { error: string }> {
  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  return { error: body.error ?? "could not log in" };
}

// The app's Fly machine scales to zero and cold-starts on the next request,
// which can take a couple of seconds — a request landing in that window
// fails outright rather than 4xx-ing. One retry rides out a cold start
// (mirrors the legacy public/login.html and room.js guest-button behavior).
export async function continueAsGuest(): Promise<boolean> {
  try {
    let res: Response;
    try {
      res = await fetch("/auth/guest", { method: "POST" });
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
      res = await fetch("/auth/guest", { method: "POST" });
    }
    return res.ok;
  } catch {
    return false;
  }
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" });
}

export async function deleteAccount(password: string): Promise<{ ok: true } | { error: string }> {
  const res = await fetch("/auth/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  return { error: body.error ?? "could not delete account" };
}

export async function adoptSession(token: string): Promise<void> {
  await fetch("/auth/adopt-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

export type { LobbyLocation };
