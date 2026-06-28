"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, verifyMfa, setSession, AdminApiError } from "@/lib/adminApi";

// Admin login. Step 1 posts to /auth/login. If the account has TOTP enabled the
// server returns an MFA challenge instead of tokens; step 2 posts the 6-digit
// (or recovery) code to /auth/mfa/verify. Only "admin"/"moderator" may obtain a
// session — anything else is refused and no token is stored.
export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When set, we're on the second (TOTP) step.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  function finishSession(role: string, accessToken: string): boolean {
    if (role !== "admin" && role !== "moderator") {
      setError("Accès réservé à l'équipe.");
      return false;
    }
    setSession(accessToken, role);
    router.replace("/admin");
    return true;
  }

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await login(email, password);
      if ("mfaRequired" in res) {
        setMfaToken(res.mfaToken);
        setSubmitting(false);
        return;
      }
      if (!finishSession(res.user.role, res.tokens.accessToken)) setSubmitting(false);
    } catch (err) {
      setError(
        err instanceof AdminApiError && err.status === 401
          ? "Email ou mot de passe incorrect."
          : err instanceof AdminApiError
            ? err.message
            : "Connexion impossible.",
      );
      setSubmitting(false);
    }
  }

  async function onCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await verifyMfa(mfaToken, code.trim());
      if (!finishSession(res.user.role, res.tokens.accessToken)) setSubmitting(false);
    } catch (err) {
      setError(
        err instanceof AdminApiError && err.status === 401
          ? "Code incorrect ou expiré."
          : err instanceof AdminApiError
            ? err.message
            : "Vérification impossible.",
      );
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full border border-[#E8DFD3] rounded-lg px-4 py-3 mb-4 focus:outline-none focus:border-[#E05206]";
  const btnCls =
    "w-full bg-[#E05206] hover:bg-[#C8470A] disabled:bg-[#E8DFD3] disabled:text-[#A89882] disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors";

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FDFBF7] px-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-[#E8DFD3] p-8">
        <div className="text-center mb-6">
          <div className="font-bold text-lg">
            <span className="text-[#E05206]">NigerConnect</span>{" "}
            <span className="text-[#5A4634]">Admin</span>
          </div>
          <p className="text-sm text-[#5A4634] mt-1">
            {mfaToken
              ? "Entre le code de ton application d'authentification."
              : "Espace réservé à l'équipe de modération."}
          </p>
        </div>

        {mfaToken ? (
          <form onSubmit={onCodeSubmit}>
            <label htmlFor="mfa-code" className="block text-sm font-semibold text-[#1A0F0A] mb-1">
              Code d&apos;authentification
            </label>
            <input
              id="mfa-code"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456 ou code de secours"
              required
              className={`${inputCls} tracking-widest text-center`}
            />
            {error ? (
              <div role="alert" className="bg-[#FCE8E8] border border-[#F5C2C2] text-[#8B1F1F] rounded-lg px-4 py-3 mb-4 text-sm">
                {error}
              </div>
            ) : null}
            <button type="submit" disabled={code.trim().length < 6 || submitting} className={btnCls}>
              {submitting ? "Vérification…" : "Vérifier"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMfaToken(null);
                setCode("");
                setError(null);
                setSubmitting(false);
              }}
              className="w-full text-[#5A4634] text-sm mt-3 hover:underline"
            >
              Revenir
            </button>
          </form>
        ) : (
          <form onSubmit={onPasswordSubmit}>
            <label htmlFor="admin-email" className="block text-sm font-semibold text-[#1A0F0A] mb-1">
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputCls}
            />
            <label htmlFor="admin-password" className="block text-sm font-semibold text-[#1A0F0A] mb-1">
              Mot de passe
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={inputCls}
            />
            {error ? (
              <div role="alert" className="bg-[#FCE8E8] border border-[#F5C2C2] text-[#8B1F1F] rounded-lg px-4 py-3 mb-4 text-sm">
                {error}
              </div>
            ) : null}
            <button
              type="submit"
              disabled={email.length === 0 || password.length === 0 || submitting}
              className={btnCls}
            >
              {submitting ? "Connexion…" : "Se connecter"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
