import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { registerAccount } from "../api";
import { useAuth } from "../context/useAuth";
import { reconnectSocket } from "../hooks/useTableSocket";

export function RegisterPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const result = await registerAccount(username, email, password);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    refresh();
    reconnectSocket();
    navigate("/");
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="font-mono text-2xl font-semibold text-ink">Register</h1>
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username (3-24, letters/digits/_/-)"
          autoComplete="username"
          required
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ANU email (you@anu.edu.au)"
          autoComplete="email"
          required
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password (8+ chars)"
          autoComplete="new-password"
          required
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
        />
        <button type="submit" className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-canvas">
          Create account
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-amber-700">{error}</p>}
      <p className="mt-4 text-sm text-ink-muted">
        Already have one?{" "}
        <Link to="/login" className="text-ink underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
