import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { getLocations, type LocationSummary } from "../api";
import { useLobbySocket } from "../hooks/useTableSocket";

const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

export function BuildingPage() {
  const { buildingSlug } = useParams<{ buildingSlug: string }>();
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const lobby = useLobbySocket();

  useEffect(() => {
    getLocations().then(setLocations);
  }, []);

  const liveBySlug = useMemo(() => {
    const map = new Map<string, { occupants: number; shadowCount: number }>();
    for (const loc of lobby ?? []) map.set(loc.slug, { occupants: loc.occupants, shadowCount: loc.shadowCount });
    return map;
  }, [lobby]);

  const rooms = locations.filter((l) => l.buildingSlug === buildingSlug);
  const buildingName = rooms[0]?.buildingName;

  if (locations.length > 0 && rooms.length === 0) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Link to="/" className="text-sm text-ink-muted underline">
          &larr; all buildings
        </Link>
        <p className="mt-4 text-sm text-ink">No such ANU building.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link to="/" className="text-sm text-ink-muted underline">
        &larr; all buildings
      </Link>
      <h1 className="mt-2 font-mono text-3xl font-semibold tracking-tight text-ink">
        {buildingName ?? "Loading…"}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">Pick a room. Join who's already there.</p>

      <motion.div
        initial="hidden"
        animate="show"
        variants={gridVariants}
        className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {rooms.map((room) => {
          const live = liveBySlug.get(room.slug);
          const active = !!live && live.occupants > 0;
          return (
            <motion.div key={room.slug} variants={cardVariants} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
              <Link
                to={`/room/${room.slug}`}
                className="block h-full rounded-xl border border-line bg-surface p-5 shadow-sm transition hover:shadow-md hover:ring-1 hover:ring-anu-gold/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2.5 font-medium text-ink">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-sage" : "bg-ink-muted/30"}`} />
                    {room.name}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-xs text-ink-muted">
                  {room.upcomingCount > 0 && <span>{room.upcomingCount} planned</span>}
                  {!!live?.shadowCount && <span>{live.shadowCount} watching</span>}
                  <span className={active ? "font-medium text-sage-dim" : ""}>{live?.occupants ?? 0} here</span>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
      {rooms.length === 0 && locations.length === 0 && <p className="mt-10 text-sm text-ink-muted">Loading rooms&hellip;</p>}
    </main>
  );
}
