"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, verifyMfa, setSession, AssoApiError } from "@/lib/assoApi";

// Back-office login. Step 1 posts to /auth/login; if the account has TOTP
// enabled the server answers with a challenge instead of tokens, and step 2
// posts the code to /auth/mfa/verify.
//
// Unlike the /admin console, NO account type is refused here: any NigerConnect
// account may sign in, because "may I administer an association?" is not a
// property of the account — it is a role held inside one association or
// another (decision Q2). What you are allowed to do is decided association by
// association, on the selector screen and, authoritatively, by the server.
export default function AssoLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  function finishSession(accessToken: string): void {
    setSession(accessToken);
    router.replace("/asso");
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
      finishSession(res.tokens.accessToken);
    } catch (err) {
      setError(messageFor(err, "Email ou mot de passe incorrect.", "Connexion impossible."));
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
      finishSession(res.tokens.accessToken);
    } catch (err) {
      setError(messageFor(err, "Code incorrect ou expiré.", "Vérification impossible."));
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
            <span className="text-[#5A4634]">Espace association</span>
          </div>
          <p className="text-sm text-[#5A4634] mt-1">
            {mfaToken
              ? "Entre le code de ton application d'authentification."
              : "Connecte-toi avec ton compte NigerConnect personnel."}
          </p>
        </div>

        {mfaToken ? (
          <form onSubmit={onCodeSubmit}>
            <label htmlFor="asso-mfa-code" className="block text-sm font-semibold text-[#1A0F0A] mb-1">
              Code d&apos;authentification
            </label>
            <input
              id="asso-mfa-code"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456 ou code de secours"
              required
              className={`${inputCls} tracking-widest text-center`}
            />
            {error ? <ErrorBox message={error} /> : null}
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
            <label htmlFor="asso-email" className="block text-sm font-semibold text-[#1A0F0A] mb-1">
              Email
            </label>
            <input
              id="asso-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputCls}
            />
            <label htmlFor="asso-password" className="block text-sm font-semibold text-[#1A0F0A] mb-1">
              Mot de passe
            </label>
            <input
              id="asso-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={inputCls}
            />
            {error ? <ErrorBox message={error} /> : null}
            <button
              type="submit"
              disabled={email.length === 0 || password.length === 0 || submitting}
              className={btnCls}
            >
              {submitting ? "Connexion…" : "Se connecter"}
            </button>
            <p className="text-xs text-[#5A4634] mt-4 text-center">
              C&apos;est le même compte que dans l&apos;application mobile. Il n&apos;y a pas de
              compte « association » partagé : chaque dirigeant se connecte avec le sien.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="bg-[#FCE8E8] border border-[#F5C2C2] text-[#8B1F1F] rounded-lg px-4 py-3 mb-4 text-sm"
    >
      {message}
    </div>
  );
}

function messageFor(err: unknown, unauthorized: string, fallback: string): string {
  if (err instanceof AssoApiError && err.status === 401) return unauthorized;
  if (err instanceof AssoApiError) return err.message;
  return fallback;
}
