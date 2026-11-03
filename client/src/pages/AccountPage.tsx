import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import {
  acceptBuddy,
  deleteAccount,
  getBuddies,
  getBuddyFeed,
  getDiet,
  getHeatmap,
  getHubStats,
  requestBuddy,
} from "../api";
import { HeatmapGrid } from "../components/HeatmapGrid";
import { DonutChart } from "../components/DonutChart";
import type { Buddy, BuddyFeedEntry, HeatmapEntry } from "../types";

export function AccountPage() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [heatmap, setHeatmap] = useState<HeatmapEntry[]>([]);
  const [diet, setDiet] = useState<{ label: string; count: number }[]>([]);
  const [hubs, setHubs] = useState<{ label: string; count: number }[]>([]);
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
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="font-mono text-2xl font-semibold text-charcoal">{me.username}</h1>
        <p className="mt-2 text-sm text-slate">
          Anonymous guest &mdash; there's nothing to manage here, and nothing is saved when you leave.
        </p>
      </main>
    );
  }

  const pendingForMe = buddies.filter((b) => b.status === "pending" && b.addresseeId === me.id);
  const accepted = buddies.filter((b) => b.status === "accepted");

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="font-mono text-2xl font-semibold text-charcoal">{me.username}</h1>
      <p className="mt-1 text-sm text-slate">{me.email}</p>
      <p className="mt-3 font-mono text-3xl text-amber-700">
        {me.vfhCount ?? 0} <span className="text-base text-slate">Verified Focus Hours</span>
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate">Heatmap</h2>
        <div className="mt-2">
          <HeatmapGrid days={heatmap} />
        </div>
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate">Cognitive diet</h2>
          <div className="mt-2">
            <DonutChart entries={diet} />
          </div>
        </div>
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate">Hubs</h2>
          <div className="mt-2">
            <DonutChart entries={hubs} />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate">Buddies</h2>
        {pendingForMe.length > 0 && (
          <div className="mt-2 space-y-1">
            {pendingForMe.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm">
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
        <p className="mt-2 text-sm text-slate">
          {accepted.length === 0 ? "No buddies yet." : `${accepted.length} buddy${accepted.length === 1 ? "" : "ies"}.`}
        </p>
        <form onSubmit={handleAddBuddy} className="mt-2 flex items-center gap-2">
          <input
            value={buddyIdInput}
            onChange={(e) => setBuddyIdInput(e.target.value)}
            placeholder="user id"
            className="w-28 rounded border border-black/15 px-2 py-1 text-sm"
          />
          <button type="submit" className="rounded-md border border-charcoal px-3 py-1.5 text-sm font-medium">
            Send buddy request
          </button>
        </form>
        {buddyError && <p className="mt-1 text-xs text-amber-700">{buddyError}</p>}

        <h3 className="mt-5 text-xs font-medium uppercase tracking-wide text-slate">Buddy feed</h3>
        <div className="mt-2 space-y-2">
          {feed.length === 0 && <p className="text-sm text-slate">Nothing from your buddies yet.</p>}
          {feed.map((f) => (
            <div key={f.ticketId} className="rounded-md border border-black/10 px-3 py-2 text-sm">
              <span className="font-medium">{f.username}</span>{" "}
              <span className="text-slate">
                at {f.locationName} &middot; {f.activityMode}
              </span>
              <p className="mt-1 font-mono text-xs opacity-80">"{f.body}"</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 border-t border-black/10 pt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-amber-700">Danger zone</h2>
        <form onSubmit={handleDelete} className="mt-2 flex items-center gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="confirm password"
            className="rounded border border-black/15 px-2 py-1 text-sm"
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
