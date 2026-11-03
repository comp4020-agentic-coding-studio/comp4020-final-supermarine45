import { useTheme } from "../context/useTheme";
import type { Theme } from "../context/theme-context";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

const NEXT: Record<Theme, Theme> = { light: "dark", dark: "system", system: "light" };
const ICON: Record<Theme, typeof SunIcon> = { light: SunIcon, dark: MoonIcon, system: MonitorIcon };
const LABEL: Record<Theme, string> = { light: "Light theme", dark: "Dark theme", system: "System theme" };

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const Icon = ICON[theme];

  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[theme])}
      title={`${LABEL[theme]} — click to switch`}
      aria-label={`${LABEL[theme]} — click to switch`}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-lg text-ink transition hover:bg-surface-muted ${className ?? ""}`}
    >
      <Icon />
    </button>
  );
}
