import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/useTheme";
import type { Theme } from "../context/theme-context";

const NEXT: Record<Theme, Theme> = { light: "dark", dark: "light" };
const ICON: Record<Theme, typeof Sun> = { light: Sun, dark: Moon };
const LABEL: Record<Theme, string> = { light: "Light theme", dark: "Dark theme" };

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const Icon = ICON[theme];

  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[theme])}
      title={`${LABEL[theme]} — click to switch`}
      aria-label={`${LABEL[theme]} — click to switch`}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink transition hover:bg-surface-muted ${className ?? ""}`}
    >
      <Icon size={18} strokeWidth={1.5} />
    </button>
  );
}
