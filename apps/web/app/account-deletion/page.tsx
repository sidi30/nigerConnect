"use client";

import { useState } from "react";
import Link from "next/link";

// Note: client component → no `metadata` export possible; the path is
// excluded from crawlers in `apps/web/app/robots.ts`.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

const CONFIRM_WORD = "SUPPRIMER";

type Stage = "form" | "success";

/**
 * Public account-deletion endpoint required by Google Play (since April 2024)
 * and Apple App Store: a user must be able to request account removal from a
 * web URL without installing the app.
 *
 * This page authenticates against the API (POST /auth/login) and immediately
 * calls DELETE /profile/me, which cascades-deletes every row and queues the
 * S3 cleanup. The API does not keep a tombstone row — the user record is
 * gone the moment this returns 204.
 */
export default function AccountDeletionPage() {
  const [stage, setStage] = useState<Stage>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    confirm.trim().toUpperCase() === CONFIRM_WORD &&
    !loading;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);

    try {
      // 1. Login to obtain a short-lived access token.
      const loginRes = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (!loginRes.ok) {
        const body = (await loginRes.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Identifiants invalides.");
      }
      const loginData = (await loginRes.json()) as {
        tokens: { accessToken: string; refreshToken: string };
      };

      // 2. Hard-delete account + cascade.
      const delRes = await fetch(`${API_URL}/profile/me`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${loginData.tokens.accessToken}` },
      });
      if (delRes.status !== 204 && !delRes.ok) {
        const body = (await delRes.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? "Suppression impossible. Réessaie.");
      }

      // 3. Best-effort logout to invalidate the refresh token in DB.
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${loginData.tokens.accessToken}`,
        },
        body: JSON.stringify({ refreshToken: loginData.tokens.refreshToken }),
      }).catch(() => null);

      setStage("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
      setLoading(false);
    }
  }

  if (stage === "success") {
    return (
      <Wrapper>
        <div className="text-6xl mb-4">✅</div>
        <h1 className="text-2xl font-bold text-[#1A0F0A] mb-3">Compte supprimé</h1>
        <p className="text-[#5A4634] leading-relaxed mb-4">
          Toutes tes données ont été effacées immédiatement de nos serveurs : profil,
          publications, messages, photos, amitiés, vérification d&apos;identité.
        </p>
        <p className="text-sm text-[#8A6B4D]">
          Les logs techniques anonymisés sont conservés 30 jours maximum pour
          prévenir les abus, puis détruits.
        </p>
        <Link
          href="/"
          className="inline-block mt-8 text-[#E05206] font-semibold hover:underline"
        >
          ← Retour à l&apos;accueil
        </Link>
      </Wrapper>
    );
  }

  return (
    <Wrapper align="left">
      <div className="text-center mb-6">
        <Link href="/" className="text-[#E05206] font-semibold hover:underline text-sm">
          ← NigerConnect
        </Link>
      </div>

      <h1 className="text-3xl font-extrabold text-[#1A0F0A] mb-2">
        Supprimer mon compte
      </h1>
      <p className="text-[#5A4634] leading-relaxed mb-6">
        Tu peux supprimer ton compte directement depuis cette page, sans télécharger
        l&apos;application. La suppression est <strong>immédiate et définitive</strong>.
      </p>

      <section className="bg-[#FFF4E0] border border-[#F4D8A8] rounded-lg p-4 mb-6 text-sm">
        <h2 className="font-extrabold text-[#1A0F0A] mb-2">Ce qui sera supprimé</h2>
        <ul className="space-y-1 text-[#5A4634]">
          <li>• Ton profil, ta bio, tes photos, ta vérification d&apos;identité</li>
          <li>• Toutes tes publications, stories, commentaires, likes</li>
          <li>• Tes amis et tes demandes d&apos;amis</li>
          <li>• Tes messages et conversations</li>
          <li>• Tes services, demandes et réponses marketplace</li>
          <li>• Tes adhésions aux associations</li>
          <li>• Tes notifications et tokens d&apos;appareil</li>
        </ul>
      </section>

      <section className="bg-white border border-[#E8DFD3] rounded-lg p-4 mb-6 text-sm">
        <h2 className="font-extrabold text-[#1A0F0A] mb-2">Ce qui est conservé</h2>
        <ul className="space-y-1 text-[#5A4634]">
          <li>
            • <strong>Aucune donnée visible</strong>. Toutes tes informations sont effacées
            de la base immédiatement.
          </li>
          <li>
            • Logs techniques <strong>anonymisés</strong> conservés{" "}
            <strong>30 jours maximum</strong> pour la sécurité (anti-fraude), puis
            détruits.
          </li>
          <li>
            • Aucune copie sur sauvegarde après la rotation hebdomadaire (dump
            chiffré, conservé 7 jours).
          </li>
        </ul>
      </section>

      <form onSubmit={onSubmit}>
        <label className="block text-sm font-semibold text-[#1A0F0A] mb-1">
          Email du compte
        </label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full border border-[#E8DFD3] rounded-lg px-4 py-3 mb-3 focus:outline-none focus:border-[#E05206]"
        />

        <label className="block text-sm font-semibold text-[#1A0F0A] mb-1">
          Mot de passe
        </label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full border border-[#E8DFD3] rounded-lg px-4 py-3 mb-3 focus:outline-none focus:border-[#E05206]"
        />

        <label className="block text-sm font-semibold text-[#1A0F0A] mb-1">
          Tape <span className="font-extrabold text-[#C0392B] tracking-widest">{CONFIRM_WORD}</span> pour confirmer
        </label>
        <input
          type="text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="w-full border border-[#E8DFD3] rounded-lg px-4 py-3 mb-4 tracking-widest focus:outline-none focus:border-[#C0392B]"
        />

        {error ? (
          <div className="bg-[#FCE8E8] border border-[#F5C2C2] text-[#8B1F1F] rounded-lg px-4 py-3 mb-4 text-sm">
            ⚠️ {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-[#C0392B] hover:bg-[#962A21] disabled:bg-[#E8DFD3] disabled:text-[#A89882] text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {loading ? "Suppression…" : "🗑️ Supprimer définitivement"}
        </button>

        <Link
          href="/"
          className="block text-center text-[#E05206] font-semibold py-3 mt-2 hover:underline"
        >
          Annuler
        </Link>
      </form>

      <section className="mt-8 pt-6 border-t border-[#E8DFD3] text-xs text-[#8A6B4D]">
        <p className="mb-1">
          <strong>Tes droits RGPD</strong> avant suppression :
        </p>
        <p>
          Tu peux demander un export complet de tes données au format JSON en écrivant
          à <a href="mailto:privacy@nigerconnect.ne" className="text-[#E05206] hover:underline">
            privacy@nigerconnect.ne
          </a>{" "}
          (réponse sous 30 jours, conformément au RGPD).
        </p>
      </section>
    </Wrapper>
  );
}

function Wrapper({
  children,
  align = "center",
}: {
  children: React.ReactNode;
  align?: "left" | "center";
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FDFBF7] px-6 py-12">
      <div
        className={`max-w-md w-full bg-white rounded-2xl shadow-sm border border-[#E8DFD3] p-8 ${
          align === "center" ? "text-center" : "text-left"
        }`}
      >
        {children}
      </div>
    </main>
  );
}
