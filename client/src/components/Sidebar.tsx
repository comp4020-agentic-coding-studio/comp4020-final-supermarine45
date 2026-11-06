import { Home, User } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { AccountControls } from "./AccountControls";

// Abstract open-book motif (two trapezoid "pages" meeting at a spine) — not a
// crest/shield/laurel. ANU's actual coat of arms must not be reproduced, and
// the visual *grammar* of heraldry is itself what risks implying false
// official affiliation, independent of the specific artwork used.
function BrandMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="7" fill="var(--color-oled)" />
      <path d="M6 10 L16 8 L16 24 L6 22 Z" fill="var(--color-anu-gold)" />
      <path d="M26 10 L16 8 L16 24 L26 22 Z" fill="var(--color-anu-gold)" opacity="0.7" />
    </svg>
  );
}

function NavLink({ to, icon: Icon, label, active }: { to: string; icon: typeof Home; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition ${
        active ? "bg-surface-muted font-medium text-ink" : "text-ink-muted hover:bg-surface-muted hover:text-ink"
      }`}
    >
      <Icon size={16} strokeWidth={1.5} className="shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function Sidebar() {
  const { me } = useAuth();
  const location = useLocation();

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface-muted sm:flex">
      <Link to="/" className="flex items-center gap-2.5 px-4 py-4">
        <BrandMark />
        <span className="truncate border-b-2 border-anu-gold/70 pb-0.5 font-mono text-sm font-semibold text-ink">
          Shut up and Read
        </span>
      </Link>

      <nav className="flex-1 space-y-3 px-3 py-2">
        <div>
          <p className="px-2.5 pb-1 font-sans text-xs font-medium uppercase tracking-wide text-ink-muted">Browse</p>
          <NavLink to="/" icon={Home} label="Hubs" active={location.pathname === "/"} />
          {me && !me.isGuest && (
            <NavLink to="/account" icon={User} label="Account" active={location.pathname === "/account"} />
          )}
        </div>
      </nav>

      <div className="flex flex-col gap-3 border-t border-line px-4 py-4">
        <AccountControls />
      </div>
    </aside>
  );
}
