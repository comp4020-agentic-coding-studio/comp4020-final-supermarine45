import { LogOut } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { logout } from "../api";
import { reconnectSocket } from "../hooks/useTableSocket";

export function AccountControls({ onNavigate }: { onNavigate?: () => void }) {
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
          <Link to="/account" onClick={onNavigate} className="text-sm text-ink-muted underline">
            {me.username} &middot; guest
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-ink-muted underline"
          >
            <LogOut size={16} strokeWidth={1.5} />
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
            <LogOut size={16} strokeWidth={1.5} />
            log out
          </button>
        </>
      )}
    </>
  );
}
