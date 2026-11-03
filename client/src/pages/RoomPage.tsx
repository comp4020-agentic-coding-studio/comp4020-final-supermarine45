import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getConfig, getLocations, type LocationSummary } from "../api";
import { useLobbySocket } from "../hooks/useTableSocket";
import { ModePicker } from "../components/ModePicker";
import type { ActivityModeInfo } from "../types";

export function RoomPage() {
  const { slug } = useParams<{ slug: string }>();
  const [modeInfo, setModeInfo] = useState<ActivityModeInfo[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const lobby = useLobbySocket();

  useEffect(() => {
    getConfig().then((c) => setModeInfo(c.activityModes));
    getLocations().then(setLocations);
  }, []);

  if (!slug) return null;

  const location = locations.find((l) => l.slug === slug);
  const live = lobby?.find((l) => l.slug === slug);

  if (locations.length > 0 && !location) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <Link to="/" className="text-sm text-slate underline">
          &larr; all buildings
        </Link>
        <p className="mt-4 text-sm text-charcoal">No such ANU location.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link
        to={location ? `/building/${location.buildingSlug}` : "/"}
        className="text-sm text-slate underline"
      >
        &larr; {location?.buildingName ?? "all buildings"}
      </Link>
      <h1 className="mt-2 font-mono text-2xl font-semibold text-charcoal">{location?.name ?? "Loading…"}</h1>
      {location && <p className="mt-1 text-sm text-slate">{location.buildingName}</p>}
      <p className="mt-3 text-sm text-slate">
        Pick a cognitive mode. Everyone matched into the same mode shares one Table, up to 6 seats.
      </p>

      <div className="mt-6">
        <ModePicker slug={slug} modeInfo={modeInfo} summaries={live?.modes} />
      </div>
    </main>
  );
}
