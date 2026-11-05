import { useCallback, useState } from "react";
import { setChimePref } from "../api";
import type { Me } from "../types";

const STORAGE_KEY = "suar:chime-enabled";

function readStoredChimePref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Registered users persist this server-side (users.chime_enabled), read back
// through the shared `me` from AuthContext so every page sees the same
// value; guests have no users row (see isGuest in db.ts) and fall back to
// localStorage entirely client-side, per the plan's Section 3.
export function useChimePreference(
  me: Me | null | undefined,
  refreshMe: () => void,
): { chimeEnabled: boolean; setChimeEnabled: (enabled: boolean) => void } {
  const [guestPref, setGuestPref] = useState(readStoredChimePref);

  const chimeEnabled = me && !me.isGuest ? !!me.chimeEnabled : guestPref;

  const setChimeEnabled = useCallback(
    (enabled: boolean) => {
      if (me && !me.isGuest) {
        setChimePref(enabled).then(refreshMe);
        return;
      }
      setGuestPref(enabled);
      try {
        localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
      } catch {
        // Nothing to persist to — the in-memory state still applies for this session.
      }
    },
    [me, refreshMe],
  );

  return { chimeEnabled, setChimeEnabled };
}
