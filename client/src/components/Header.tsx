import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { logout } from "../api";
import { reconnectSocket } from "../hooks/useTableSocket";
import { LogOutIcon, MenuIcon, XIcon } from "./icons";
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

function AccountControls({ onNavigate }: { onNavigate?: () => void }) {
  const { me, refresh } = useAuth();

  async function handleLogout(): Promise<void> {
    await logout();
    refresh();
    reconnectSocket();
    onNavigate?.();
  }

  return (
    <>
      {me === undefined && <span className="text-sm text-ink-muted">&hellip;</span>}
      {me === null && (
        <Link to="/login" onClick={onNavigate} className="text-sm font-medium text-ink underline">
          log in
        </Link>
      )}
      {me && me.isGuest && (
        <>
          <span className="text-sm text-ink-muted">{me.username} &middot; guest</span>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-ink-muted underline"
          >
            <LogOutIcon className="text-base" />
            log out
          </button>
        </>
      )}
      {me && !me.isGuest && (
        <>
          <Link to="/account" onClick={onNavigate} className="text-sm font-medium text-ink">
            {me.username} &middot; {me.vfhCount ?? 0} VFH
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-ink-muted underline"
          >
            <LogOutIcon className="text-base" />
            log out
          </button>
        </>
      )}
    </>
  );
}

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="relative border-b border-line px-4 py-4 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className="flex min-w-0 items-center gap-2.5" onClick={() => setMenuOpen(false)}>
          <BrandMark />
          <span className="truncate border-b-2 border-anu-gold/70 pb-0.5 font-mono text-lg font-semibold text-ink">
            Shut up and Read
          </span>
        </Link>

        <div className="hidden items-center gap-4 sm:flex">
          <AccountControls />
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-1 sm:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xl text-ink transition hover:bg-surface-muted"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <XIcon /> : <MenuIcon />}
          </button>
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
