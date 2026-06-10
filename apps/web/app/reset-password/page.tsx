"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

// Note: this is a client component, so we cannot export `metadata` directly.
// The `noindex` is set globally for /reset-password via `robots.ts` which
// disallows the path for crawlers — see apps/web/app/robots.ts.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// `useSearchParams()` opts a client component out of static prerender unless it
// sits under a Suspense boundary (Next 15+ requirement). The page export below
// provides that boundary so `next build` can statically render the shell.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Wrapper><div className="text-[#5A4634]">Chargement…</div></Wrapper>}>
      <ResetPasswordForm />
    </Suspense>
  );
}

const PASSWORD_REQUIREMENTS = [
  { id: "length", label: "12 caractères minimum", check: (s: string) => s.length >= 12 },
  { id: "upper", label: "Une majuscule", check: (s: string) => /[A-Z]/.test(s) },
  { id: "digit", label: "Un chiffre", check: (s: string) => /[0-9]/.test(s) },
  { id: "special", label: "Un caractère spécial", check: (s: string) => /[^A-Za-z0-9]/.test(s) },
];

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reqs = PASSWORD_REQUIREMENTS.map((r) => ({ ...r, ok: r.check(password) }));
  const allOk = reqs.every((r) => r.ok);
  const matches = password.length > 0 && password === confirm;
  const canSubmit = allOk && matches && !submitting && Boolean(token);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Lien invalide ou expiré.");
        setSubmitting(false);
        return;
      }
      setDone(true);
      // Hard redirect to home after 4s. Mobile users will already be in-app.
      setTimeout(() => router.push("/"), 4000);
    } catch {
      setError("Impossible de joindre le serveur. Réessaie.");
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <Wrapper>
        <div className="text-6xl mb-4">⚠️</div>
        <h1 className="text-2xl font-bold text-[#1A0F0A] mb-3">Lien incomplet</h1>
        <p className="text-[#5A4634] mb-6">Le lien de réinitialisation est invalide.</p>
        <Link href="/" className="text-[#E05206] font-semibold hover:underline">
          ← Retour à l&apos;accueil
        </Link>
      </Wrapper>
    );
  }

  if (done) {
    return (
      <Wrapper>
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-2xl font-bold text-[#1A0F0A] mb-3">Mot de passe mis à jour</h1>
        <p className="text-[#5A4634]">
          Tu peux retourner dans l&apos;app NigerConnect et te reconnecter avec ton nouveau mot de passe.
        </p>
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <h1 className="text-2xl font-bold text-[#1A0F0A] mb-2">Nouveau mot de passe</h1>
      <p className="text-[#5A4634] mb-6">Choisis un mot de passe solide pour ton compte.</p>

      <form onSubmit={onSubmit} className="text-left">
        <label className="block text-sm font-semibold text-[#1A0F0A] mb-1">Mot de passe</label>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          maxLength={128}
          className="w-full border border-[#E8DFD3] rounded-lg px-4 py-3 mb-3 focus:outline-none focus:border-[#E05206]"
        />

        <label className="block text-sm font-semibold text-[#1A0F0A] mb-1">Confirmer</label>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          maxLength={128}
          className="w-full border border-[#E8DFD3] rounded-lg px-4 py-3 mb-3 focus:outline-none focus:border-[#E05206]"
        />

        <ul className="text-sm mb-2">
          {reqs.map((r) => (
            <li key={r.id} className={r.ok ? "text-[#0DB02B]" : "text-[#8A6B4D]"}>
              {r.ok ? "✓" : "·"} {r.label}
            </li>
          ))}
          <li className={matches ? "text-[#0DB02B]" : "text-[#8A6B4D]"}>
            {matches ? "✓" : "·"} Les deux mots de passe correspondent
          </li>
        </ul>

        {error ? (
          <div className="bg-[#FCE8E8] border border-[#F5C2C2] text-[#8B1F1F] rounded-lg px-4 py-3 mb-4 text-sm">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-[#E05206] hover:bg-[#C8470A] disabled:bg-[#E8DFD3] disabled:text-[#A89882] text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {submitting ? "Mise à jour…" : "Mettre à jour"}
        </button>
      </form>
    </Wrapper>
  );
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FDFBF7] px-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-[#E8DFD3] p-8 text-center">
        {children}
      </div>
    </main>
  );
}
