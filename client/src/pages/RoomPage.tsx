import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { getConfig, getLocationHistory, getLocationStats, getLocations, type LocationSummary } from "../api";
import { useLobbySocket } from "../hooks/useTableSocket";
import { useNow } from "../hooks/useNow";
import { ModePicker } from "../components/ModePicker";
import { OutcomeBadge } from "../components/OutcomeBadge";
import { Avatar } from "../components/Avatar";
import { Callout } from "../components/Callout";
import { ModeIcon } from "../components/icons";
import type { ActivityModeInfo, LocationHistoryEntry, LocationStats } from "../types";

export function RoomPage() {
  const { slug } = useParams<{ slug: string }>();
  const [modeInfo, setModeInfo] = useState<ActivityModeInfo[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [history, setHistory] = useState<LocationHistoryEntry[]>([]);
  const [stats, setStats] = useState<LocationStats | null>(null);
  const lobby = useLobbySocket();
  const now = useNow();

  useEffect(() => {
    getConfig().then((c) => setModeInfo(c.activityModes));
    getLocations().then(setLocations);
  }, []);

  useEffect(() => {
    if (!slug) return;
    getLocationHistory(slug).then((r) => setHistory(r.history));
    getLocationStats(slug).then(setStats);
  }, [slug]);

  if (!slug) return null;

  const location = locations.find((l) => l.slug === slug);
  const live = lobby?.find((l) => l.slug === slug);

  if (locations.length > 0 && !location) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Link to="/" className="text-sm text-ink-muted underline">
          &larr; all buildings
        </Link>
        <p className="mt-4 text-sm text-ink">No such ANU location.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link
        to={location ? `/building/${location.buildingSlug}` : "/"}
        className="text-sm text-ink-muted underline"
      >
        &larr; {location?.buildingName ?? "all buildings"}
      </Link>
      <div className="mt-4 h-20 rounded-2xl bg-gradient-to-br from-accent-tint to-surface" />

      <h1 className="mt-4 font-sans text-[32px] font-semibold tracking-tight text-ink">{location?.name ?? "Loading…"}</h1>
      {location && <p className="mt-1 text-sm text-ink-muted">{location.buildingName}</p>}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <Callout tone="blue">
            Pick a cognitive mode. Everyone matched into the same mode shares one Table, up to 6 seats.
          </Callout>
          <div className="mt-4">
            <ModePicker slug={slug} modeInfo={modeInfo} summaries={live?.modes} now={now} />
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-3 content-start lg:grid-cols-1">
            <div className="rounded-xl border border-line bg-surface p-3">
              <p className="font-sans text-xs font-medium uppercase tracking-wide text-ink-muted">This week</p>
              <p className="mt-1 flex items-center gap-1.5 font-mono text-2xl text-ink">
                <Flame size={20} strokeWidth={1.5} className="text-amber-600" />
                {stats.vfhThisWeek}
              </p>
              <p className="text-xs text-ink-muted">Verified Focus {stats.vfhThisWeek === 1 ? "Hour" : "Hours"}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-3">
              <p className="font-sans text-xs font-medium uppercase tracking-wide text-ink-muted">Rollovers</p>
              <p className="mt-1 font-mono text-2xl text-ink">{stats.lastActiveRollovers}</p>
              <p className="text-xs text-ink-muted">last active table</p>
            </div>
          </div>
        )}
      </div>

      <section className="mt-10">
        <h2 className="font-sans text-xl font-semibold text-ink">Recently here</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No sessions logged here yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {history.map((h) => (
              <div
                key={h.ticketId}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3"
              >
                <Avatar name={h.username} size={32} />
                <ModeIcon mode={h.activityMode} className="shrink-0 text-lg text-ink-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{h.username}</p>
                  <p className="truncate font-mono text-xs text-ink-muted">"{h.body}"</p>
                </div>
                <OutcomeBadge stamp={h.stamp} stayedFullBlock={h.stayedFullBlock} />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
