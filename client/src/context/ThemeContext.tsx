import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ThemeContext, type Theme } from "./theme-context";

const STORAGE_KEY = "suar:theme";

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
    // Stale "system" value from before that option was removed — resolve it
    // once against the OS preference instead of silently defaulting to light.
    if (stored === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    // localStorage unavailable (private browsing, disabled storage) — fall back to light.
  }
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Nothing to persist to — the in-memory state still applies for this session.
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, resolvedTheme: theme, setTheme }}>{children}</ThemeContext.Provider>;
}
