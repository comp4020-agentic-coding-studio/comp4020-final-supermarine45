import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { continueAsGuest, loginAccount } from "../api";
import { useAuth } from "../context/useAuth";
import { reconnectSocket } from "../hooks/useTableSocket";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const result = await loginAccount(username, password);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    refresh();
    reconnectSocket();
    navigate("/");
  }

  async function handleGuest(): Promise<void> {
    setGuestError(null);
    setGuestBusy(true);
    try {
      const ok = await continueAsGuest();
      if (ok) {
        refresh();
        reconnectSocket();
        navigate("/");
      } else {
        setGuestError("Couldn't start a guest session — try again.");
      }
    } finally {
      setGuestBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="font-mono text-2xl font-semibold text-ink">Log in</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          autoComplete="username"
          required
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          autoComplete="current-password"
          required
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
        />
        <button type="submit" className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas">
          Log in
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-amber-700">{error}</p>}
      <p className="mt-4 text-sm text-ink-muted">
        No account?{" "}
        <Link to="/register" className="text-ink underline">
          Register
        </Link>
      </p>
      <hr className="my-6 border-line" />
      <button
        type="button"
        onClick={handleGuest}
        disabled={guestBusy}
        className="w-full rounded-md border border-line px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
      >
        Continue anonymously
      </button>
      {guestError && <p className="mt-2 text-sm text-amber-700">{guestError}</p>}
      <p className="mt-2 text-xs text-ink-muted">
        No account — a random name, nothing saved when you leave, no stats or ranking.
      </p>
    </main>
  );
}
