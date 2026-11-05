import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getConfig, getLocationHistory, getLocations, type LocationSummary } from "../api";
import { useLobbySocket } from "../hooks/useTableSocket";
import { useNow } from "../hooks/useNow";
import { ModePicker } from "../components/ModePicker";
import { OutcomeBadge } from "../components/OutcomeBadge";
import { Avatar } from "../components/Avatar";
import { ModeIcon } from "../components/icons";
import type { ActivityModeInfo, LocationHistoryEntry } from "../types";

export function RoomPage() {
  const { slug } = useParams<{ slug: string }>();
  const [modeInfo, setModeInfo] = useState<ActivityModeInfo[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [history, setHistory] = useState<LocationHistoryEntry[]>([]);
  const lobby = useLobbySocket();
  const now = useNow();

  useEffect(() => {
    getConfig().then((c) => setModeInfo(c.activityModes));
    getLocations().then(setLocations);
  }, []);

  useEffect(() => {
    if (!slug) return;
    getLocationHistory(slug).then((r) => setHistory(r.history));
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
      <h1 className="mt-2 font-mono text-2xl font-semibold text-ink">{location?.name ?? "Loading…"}</h1>
      {location && <p className="mt-1 text-sm text-ink-muted">{location.buildingName}</p>}
      <p className="mt-3 text-sm text-ink-muted">
        Pick a cognitive mode. Everyone matched into the same mode shares one Table, up to 6 seats.
      </p>

      <div className="mt-6">
        <ModePicker slug={slug} modeInfo={modeInfo} summaries={live?.modes} now={now} />
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-ink-muted">Recently here</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No sessions logged here yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {history.map((h) => (
              <div
                key={h.ticketId}
                className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3"
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
