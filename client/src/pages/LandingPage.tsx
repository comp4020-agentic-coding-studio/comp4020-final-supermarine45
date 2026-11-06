import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { getLocations, type LocationSummary } from "../api";
import { useLobbySocket } from "../hooks/useTableSocket";
import { hueFor } from "../components/Avatar";

interface BuildingCard {
  slug: string;
  name: string;
  roomCount: number;
  occupants: number;
  shadowCount: number;
}

const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0 },
};

export function LandingPage() {
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

  const buildings = useMemo<BuildingCard[]>(() => {
    const map = new Map<string, BuildingCard>();
    for (const loc of locations) {
      if (!map.has(loc.buildingSlug)) {
        map.set(loc.buildingSlug, { slug: loc.buildingSlug, name: loc.buildingName, roomCount: 0, occupants: 0, shadowCount: 0 });
      }
      const entry = map.get(loc.buildingSlug)!;
      const live = liveBySlug.get(loc.slug);
      entry.roomCount += 1;
      entry.occupants += live?.occupants ?? 0;
      entry.shadowCount += live?.shadowCount ?? 0;
    }
    return [...map.values()];
  }, [locations, liveBySlug]);

  const totalHere = useMemo(() => buildings.reduce((sum, b) => sum + b.occupants, 0), [buildings]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-16">
      <div className="h-32 rounded-2xl bg-gradient-to-br from-accent-tint to-surface" />

      <p className="mt-6 font-mono text-xs uppercase tracking-wide text-ink-muted">
        {totalHere > 0 ? `${totalHere} ${totalHere === 1 ? "person" : "people"} here now` : "Quiet on campus right now"}
      </p>
      <h1 className="mt-2 font-sans text-[32px] font-semibold tracking-tight text-ink">Where is everyone right now?</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-muted">Pick an ANU building. Then pick a room and join who's already there.</p>

      <motion.div
        initial="hidden"
        animate="show"
        variants={gridVariants}
        className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {buildings.map((building) => {
          const active = building.occupants > 0;
          return (
            <motion.div key={building.slug} variants={cardVariants} whileHover={{ y: -3 }} whileTap={{ scale: 0.98 }}>
              <Link
                to={`/building/${building.slug}`}
                className="block h-full overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-notion-sm)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-notion-md)]"
              >
                <div className="h-1.5" style={{ background: `hsl(${hueFor(building.name)} 45% 55%)` }} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-ink">{building.name}</h2>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-sage" : "bg-ink-muted/30"}`} />
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {building.roomCount} {building.roomCount === 1 ? "room" : "rooms"}
                  </p>
                  <div className="mt-4 flex items-center gap-3 font-mono text-xs text-ink-muted">
                    {building.shadowCount > 0 && <span>{building.shadowCount} watching</span>}
                    <span className={active ? "font-medium text-sage-dim" : ""}>{building.occupants} here</span>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
      {buildings.length === 0 && <p className="mt-12 text-sm text-ink-muted">Loading locations&hellip;</p>}
    </main>
  );
}
