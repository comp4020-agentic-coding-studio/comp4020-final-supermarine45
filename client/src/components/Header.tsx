import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { AccountControls } from "./AccountControls";
import { ThemeToggle } from "./ThemeToggle";

// Abstract open-book motif (two trapezoid "pages" meeting at a spine) — not a
// crest/shield/laurel. ANU's actual coat of arms must not be reproduced, and
// the visual *grammar* of heraldry is itself what risks implying false
// official affiliation, independent of the specific artwork used.
function BrandMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="7" fill="var(--color-oled)" />
      <path d="M6 10 L16 8 L16 24 L6 22 Z" fill="var(--color-anu-gold)" />
      <path d="M26 10 L16 8 L16 24 L26 22 Z" fill="var(--color-anu-gold)" opacity="0.7" />
    </svg>
  );
}

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="relative border-b border-line px-4 py-3 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5 sm:hidden"
          onClick={() => setMenuOpen(false)}
        >
          <BrandMark />
          <span className="truncate border-b-2 border-anu-gold/70 pb-0.5 font-mono text-lg font-semibold text-ink">
            Shut up and Read
          </span>
        </Link>

        <div className="hidden flex-1 sm:block" />

        <div className="flex items-center gap-1 sm:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink transition hover:bg-surface-muted"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={20} strokeWidth={1.5} /> : <Menu size={20} strokeWidth={1.5} />}
          </button>
        </div>

        <div className="hidden sm:block">
          <ThemeToggle />
        </div>
      </div>

      {menuOpen && (
        <div className="absolute inset-x-0 top-full z-20 border-b border-line bg-surface px-4 py-4 shadow-md sm:hidden">
          <div className="flex flex-col items-start gap-3">
            <AccountControls onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}
    </header>
  );
}
