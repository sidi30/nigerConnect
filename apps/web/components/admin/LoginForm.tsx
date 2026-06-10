"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, setSession, AdminApiError } from "@/lib/adminApi";

// Admin login. Posts to /auth/login, then gates on the returned role: only
// "admin" / "moderator" may obtain a session. Anything else is refused and the
// token is NOT stored.
export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { user, tokens } = await login(email, password);
      if (user.role !== "admin" && user.role !== "moderator") {
        setError("Accès réservé à l'équipe.");
        setSubmitting(false);
        return;
      }
      setSession(tokens.accessToken, user.role);
      router.replace("/admin");
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        setError("Email ou mot de passe incorrect.");
      } else {
        setError(
          err instanceof AdminApiError ? err.message : "Connexion impossible.",
        );
      }
      setSubmitting(false);
    }
  }

  const canSubmit = email.length > 0 && password.length > 0 && !submitting;

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FDFBF7] px-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-[#E8DFD3] p-8">
        <div className="text-center mb-6">
          <div className="font-bold text-lg">
            <span className="text-[#E05206]">NigerConnect</span>{" "}
            <span className="text-[#5A4634]">Admin</span>
          </div>
          <p className="text-sm text-[#5A4634] mt-1">
            Espace réservé à l&apos;équipe de modération.
          </p>
        </div>

        <form onSubmit={onSubmit}>
          <label
            htmlFor="admin-email"
            className="block text-sm font-semibold text-[#1A0F0A] mb-1"
          >
            Email
          </label>
          <input
            id="admin-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border border-[#E8DFD3] rounded-lg px-4 py-3 mb-4 focus:outline-none focus:border-[#E05206]"
          />

          <label
            htmlFor="admin-password"
            className="block text-sm font-semibold text-[#1A0F0A] mb-1"
          >
            Mot de passe
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border border-[#E8DFD3] rounded-lg px-4 py-3 mb-4 focus:outline-none focus:border-[#E05206]"
          />

          {error ? (
            <div
              role="alert"
              className="bg-[#FCE8E8] border border-[#F5C2C2] text-[#8B1F1F] rounded-lg px-4 py-3 mb-4 text-sm"
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full bg-[#E05206] hover:bg-[#C8470A] disabled:bg-[#E8DFD3] disabled:text-[#A89882] disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {submitting ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    </main>
  );
}
