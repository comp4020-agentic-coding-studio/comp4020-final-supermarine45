import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { useChimePreference } from "../hooks/useChimePreference";
import {
  acceptBuddy,
  deleteAccount,
  getBuddies,
  getBuddyFeed,
  getDiet,
  getHeatmap,
  getHistory,
  getHubStats,
  getStreaks,
  requestBuddy,
} from "../api";
import { HeatmapGrid } from "../components/HeatmapGrid";
import { DonutChart } from "../components/DonutChart";
import { OutcomeBadge } from "../components/OutcomeBadge";
import { Button } from "../components/Button";
import { Divider } from "../components/Divider";
import { Disclosure } from "../components/Disclosure";
import { ModeIcon } from "../components/icons";
import type { Buddy, BuddyFeedEntry, HeatmapEntry, StreakEntry, UserHistoryEntry } from "../types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_SESSIONS_SHOWN = 5;

export function AccountPage() {
  const { me, refresh } = useAuth();
  const { chimeEnabled, setChimeEnabled } = useChimePreference(me, refresh);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const navigate = useNavigate();
  const [heatmap, setHeatmap] = useState<HeatmapEntry[]>([]);
  const [diet, setDiet] = useState<{ label: string; count: number }[]>([]);
  const [hubs, setHubs] = useState<{ label: string; count: number }[]>([]);
  const [history, setHistory] = useState<UserHistoryEntry[]>([]);
  const [streaks, setStreaks] = useState<StreakEntry[]>([]);
  const [buddies, setBuddies] = useState<Buddy[]>([]);
  const [feed, setFeed] = useState<BuddyFeedEntry[]>([]);
  const [buddyIdInput, setBuddyIdInput] = useState("");
  const [buddyError, setBuddyError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!me || me.isGuest) return;
    getHeatmap().then((r) => setHeatmap(r.days));
    getDiet().then((r) => setDiet(r.modes.map((m) => ({ label: m.mode, count: m.count }))));
    getHubStats().then((r) => setHubs(r.hubs.map((h) => ({ label: h.locationName, count: h.count }))));
    getHistory().then((r) => setHistory(r.history));
    getStreaks().then((r) => setStreaks(r.streaks));
    getBuddies().then((r) => setBuddies(r.buddies));
    getBuddyFeed().then((r) => setFeed(r.feed));
  }, [me]);

  if (me === undefined) return null;
  if (me === null) {
    navigate("/login");
    return null;
  }

  async function handleDelete(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setDeleteError(null);
    const result = await deleteAccount(password);
    if ("error" in result) setDeleteError(result.error);
    else {
      refresh();
      navigate("/");
    }
  }

  async function handleAddBuddy(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBuddyError(null);
    const id = Number(buddyIdInput);
    if (!Number.isFinite(id)) {
      setBuddyError("Enter a numeric user id.");
      return;
    }
    const result = await requestBuddy(id);
    if ("error" in result) {
      setBuddyError(result.error);
      return;
    }
    setBuddyIdInput("");
    getBuddies().then((r) => setBuddies(r.buddies));
  }

  if (me.isGuest) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="font-sans text-[32px] font-semibold tracking-tight text-ink">{me.username}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Anonymous guest &mdash; there's nothing to manage here, and nothing is saved when you leave.
        </p>
        <NotificationPrefs
          chimeEnabled={chimeEnabled}
          setChimeEnabled={setChimeEnabled}
          notifPermission={notifPermission}
          setNotifPermission={setNotifPermission}
        />
      </main>
    );
  }

  const pendingForMe = buddies.filter((b) => b.status === "pending" && b.addresseeId === me.id);
  const accepted = buddies.filter((b) => b.status === "accepted");
  const currentStreak = streaks.reduce((max, s) => Math.max(max, s.currentStreak), 0);
  const sessionsThisWeek = history.filter((h) => Date.now() - h.cycleStartAt < WEEK_MS).length;
  const recentSessions = history.slice(0, RECENT_SESSIONS_SHOWN);
  const olderSessions = history.slice(RECENT_SESSIONS_SHOWN);
  const completedCount = history.filter((h) => h.stamp !== null && h.stayedFullBlock).length;
  const notCompletedCount = history.filter((h) => h.stamp === null && h.stayedFullBlock).length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="font-sans text-[32px] font-semibold tracking-tight text-ink">{me.username}</h1>
      <p className="mt-1 text-sm text-ink-muted">{me.email}</p>

      {/* Pinned properties — the headline numbers, up front, database-style. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Verified Focus Hours" value={me.vfhCount ?? 0} />
        <StatCard label="Current streak" value={currentStreak} />
        <StatCard label="Sessions this week" value={sessionsThisWeek} />
        <StatCard label="Buddies" value={accepted.length} />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="font-sans text-xl font-semibold text-ink">Heatmap</h2>
            <div className="mt-2">
              <HeatmapGrid days={heatmap} />
            </div>
          </section>

          <section>
            <h2 className="font-sans text-xl font-semibold text-ink">Recent sessions</h2>
            {history.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No sessions logged yet.</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-ink-muted">
                  {completedCount} completed &middot; {notCompletedCount} not completed
                </p>
                <div className="mt-2 space-y-2">
                  {recentSessions.map((h) => (
                    <SessionRow key={h.ticketId} entry={h} />
                  ))}
                </div>
                {olderSessions.length > 0 && (
                  <div className="mt-3">
                    <Disclosure label={`Show ${olderSessions.length} more`}>
                      <div className="space-y-2">
                        {olderSessions.map((h) => (
                          <SessionRow key={h.ticketId} entry={h} />
                        ))}
                      </div>
                    </Disclosure>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <div className="space-y-8">
          {streaks.length > 0 && (
            <section>
              <h3 className="font-sans text-sm font-semibold uppercase tracking-wide text-ink-muted">Streaks</h3>
              <div className="mt-2 space-y-2">
                {streaks.map((s) => (
                  <div
                    key={`${s.locationName}-${s.activityMode}`}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3"
                  >
                    <Flame size={20} strokeWidth={1.5} className="shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {s.locationName} &middot; {s.activityMode}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {s.currentStreak} current &middot; {s.longestStreak} longest
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 className="font-sans text-sm font-semibold uppercase tracking-wide text-ink-muted">Cognitive diet</h3>
            <div className="mt-2">
              <DonutChart entries={diet} />
            </div>
          </section>

          <section>
            <h3 className="font-sans text-sm font-semibold uppercase tracking-wide text-ink-muted">Hubs</h3>
            <div className="mt-2">
              <DonutChart entries={hubs} />
            </div>
          </section>

          <NotificationPrefs
            chimeEnabled={chimeEnabled}
            setChimeEnabled={setChimeEnabled}
            notifPermission={notifPermission}
            setNotifPermission={setNotifPermission}
          />
        </div>
      </div>

      <Divider />

      <section>
        <h2 className="font-sans text-xl font-semibold text-ink">Buddies</h2>
        {pendingForMe.length > 0 && (
          <div className="mt-2 space-y-1">
            {pendingForMe.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm text-ink">
                <span>Request from user #{b.requesterId}</span>
                <button
                  type="button"
                  onClick={() =>
                    acceptBuddy(b.requesterId).then(() => getBuddies().then((r) => setBuddies(r.buddies)))
                  }
                  className="rounded-md bg-sage px-2 py-1 text-xs font-medium text-espresso"
                >
                  Accept
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-sm text-ink-muted">
          {accepted.length === 0 ? "No buddies yet." : `${accepted.length} buddy${accepted.length === 1 ? "" : "ies"}.`}
        </p>
        <form onSubmit={handleAddBuddy} className="mt-2 flex items-center gap-2">
          <input
            value={buddyIdInput}
            onChange={(e) => setBuddyIdInput(e.target.value)}
            placeholder="user id"
            className="w-28 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
          <Button type="submit" variant="secondary" size="sm">
            Send buddy request
          </Button>
        </form>
        {buddyError && <p className="mt-1 text-xs text-amber-700">{buddyError}</p>}

        <div className="mt-5">
          <Disclosure label="Buddy feed">
            <div className="space-y-2">
              {feed.length === 0 && <p className="text-sm text-ink-muted">Nothing from your buddies yet.</p>}
              {feed.map((f) => (
                <div key={f.ticketId} className="rounded-md border border-line px-3 py-2 text-sm text-ink">
                  <span className="font-medium">{f.username}</span>{" "}
                  <span className="text-ink-muted">
                    at {f.locationName} &middot; {f.activityMode}
                  </span>
                  <p className="mt-1 font-mono text-xs opacity-80">"{f.body}"</p>
                </div>
              ))}
            </div>
          </Disclosure>
        </div>
      </section>

      <Divider />

      <section>
        <h3 className="font-sans text-sm font-semibold uppercase tracking-wide text-amber-700">Danger zone</h3>
        <form onSubmit={handleDelete} className="mt-2 flex items-center gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="confirm password"
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
          <button type="submit" className="rounded-md border border-amber-700 px-3 py-1.5 text-sm font-medium text-amber-700">
            Delete account
          </button>
        </form>
        {deleteError && <p className="mt-1 text-xs text-amber-700">{deleteError}</p>}
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <p className="font-sans text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl text-ink">{value}</p>
    </div>
  );
}

function SessionRow({ entry: h }: { entry: UserHistoryEntry }) {
  return (
    <Link
      to={`/room/${h.locationSlug}`}
      className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-notion-sm)] transition hover:shadow-[var(--shadow-notion-md)]"
    >
      <ModeIcon mode={h.activityMode} className="shrink-0 text-lg text-ink-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{h.locationName}</p>
        <p className="truncate font-mono text-xs text-ink-muted">"{h.body}"</p>
      </div>
      <OutcomeBadge stamp={h.stamp} stayedFullBlock={h.stayedFullBlock} />
    </Link>
  );
}

// Both chimes and notifications are opt-in (muted/unasked by default) — see
// the plan's locked-in decisions. requestPermission() must run from a real
// click handler; browsers reject a programmatic call.
function NotificationPrefs({
  chimeEnabled,
  setChimeEnabled,
  notifPermission,
  setNotifPermission,
}: {
  chimeEnabled: boolean;
  setChimeEnabled: (enabled: boolean) => void;
  notifPermission: NotificationPermission | "unsupported";
  setNotifPermission: (p: NotificationPermission) => void;
}) {
  async function handleEnableNotifications(): Promise<void> {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="font-sans text-sm font-semibold uppercase tracking-wide text-ink-muted">Notifications</h3>
      <label className="mt-3 flex items-center justify-between gap-3 text-sm text-ink">
        <span>Chime sounds on phase shifts</span>
        <input
          type="checkbox"
          checked={chimeEnabled}
          onChange={(e) => setChimeEnabled(e.target.checked)}
          className="h-4 w-4"
        />
      </label>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm text-ink">
          OS notifications for kudos &amp; whiteboard opens
          {notifPermission === "granted" && <span className="ml-1 text-xs text-sage-dim">(enabled)</span>}
          {notifPermission === "denied" && <span className="ml-1 text-xs text-amber-700">(blocked in browser settings)</span>}
        </span>
        {notifPermission !== "unsupported" && notifPermission !== "granted" && notifPermission !== "denied" && (
          <Button variant="secondary" size="sm" onClick={handleEnableNotifications} className="shrink-0">
            Enable notifications
          </Button>
        )}
      </div>
    </section>
  );
}
