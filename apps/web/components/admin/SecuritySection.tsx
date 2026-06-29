"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { KeyRound, ShieldCheck, ShieldAlert, Copy, Check } from "lucide-react";
import {
  mfaStatus,
  mfaEnroll,
  mfaConfirm,
  mfaDisable,
  fetchAdminSettings,
  patchAdminSettings,
  AdminApiError,
  type AdminRole,
} from "@/lib/adminApi";
import { Card, ErrorBanner, GhostButton, PrimaryButton, Skeleton, StatusChip } from "./ui";

type EnrollState = { secret: string; otpauthUrl: string; qr: string } | null;

export default function SecuritySection({ role }: { role: AdminRole | null }) {
  const isAdmin = role === "admin";
  const [loading, setLoading] = useState(true);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [required, setRequired] = useState(false);
  const [fullVis, setFullVis] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // enrollment flow
  const [enroll, setEnroll] = useState<EnrollState>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  // disable flow
  const [disabling, setDisabling] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await mfaStatus();
      setMfaEnabled(s.mfaEnabled);
      if (isAdmin) {
        const settings = await fetchAdminSettings();
        setRequired(settings.adminMfaRequired);
        setFullVis(settings.adminFullVisibility);
      }
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function startEnroll() {
    setBusy(true);
    setError(null);
    try {
      const res = await mfaEnroll();
      const qr = await QRCode.toDataURL(res.otpauthUrl, { width: 220, margin: 1 });
      setEnroll({ ...res, qr });
      setCode("");
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Activation impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    setBusy(true);
    setError(null);
    try {
      const { recoveryCodes } = await mfaConfirm(code.trim());
      setRecoveryCodes(recoveryCodes);
      setEnroll(null);
      setMfaEnabled(true);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Code incorrect.");
    } finally {
      setBusy(false);
    }
  }

  async function doDisable() {
    setBusy(true);
    setError(null);
    try {
      await mfaDisable(disableCode.trim());
      setMfaEnabled(false);
      setDisabling(false);
      setDisableCode("");
      // turning MFA off also (server-side) keeps the required policy; if it was
      // on, re-check so the UI reflects you may now be at risk of lockout.
      await refresh();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Code incorrect.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRequired(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const s = await patchAdminSettings({ adminMfaRequired: next });
      setRequired(s.adminMfaRequired);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Mise à jour impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFullVis(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const s = await patchAdminSettings({ adminFullVisibility: next });
      setFullVis(s.adminFullVisibility);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Mise à jour impossible.");
    } finally {
      setBusy(false);
    }
  }

  function copyCodes() {
    if (!recoveryCodes) return;
    void navigator.clipboard?.writeText(recoveryCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const input =
    "w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-400/50";

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-[#1A0F0A]">Sécurité</h2>
        <p className="text-sm text-[#8A6B4D] mt-0.5">
          Double authentification (TOTP) — Google Authenticator, Authy, 1Password…
        </p>
      </div>

      {error ? <div className="mb-4"><ErrorBanner message={error} /></div> : null}

      {loading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        <div className="space-y-4">
          {/* ── MFA status / enroll / disable ─────────────────────────────── */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              {mfaEnabled ? (
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-amber-500" />
              )}
              <h3 className="font-bold text-[#1A0F0A]">Authentificateur</h3>
              <StatusChip tone={mfaEnabled ? "green" : "amber"}>
                {mfaEnabled ? "Activé" : "Désactivé"}
              </StatusChip>
            </div>

            {/* one-time recovery codes after a fresh enrollment */}
            {recoveryCodes ? (
              <div className="rounded-lg border border-[#E8DFD3] bg-[#FFF8F3] p-4">
                <p className="text-sm font-semibold text-[#1A0F0A] mb-1">
                  Codes de secours — note-les maintenant, ils ne seront plus affichés.
                </p>
                <p className="text-xs text-[#8A6B4D] mb-3">
                  Chaque code fonctionne une seule fois si tu perds ton téléphone.
                </p>
                <div className="grid grid-cols-2 gap-2 font-mono text-sm text-[#1A0F0A]">
                  {recoveryCodes.map((c) => (
                    <span key={c} className="bg-white border border-[#E8DFD3] rounded px-2 py-1 text-center">
                      {c}
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 mt-3">
                  <GhostButton onClick={copyCodes}>
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? " Copiés" : " Copier"}
                  </GhostButton>
                  <PrimaryButton onClick={() => setRecoveryCodes(null)}>J&apos;ai noté</PrimaryButton>
                </div>
              </div>
            ) : enroll ? (
              <div className="flex flex-col sm:flex-row gap-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={enroll.qr} alt="QR code d'enrôlement" width={200} height={200} className="rounded-lg border border-[#E8DFD3]" />
                <div className="flex-1">
                  <p className="text-sm text-[#5A4634] mb-2">
                    Scanne le QR dans ton app, ou saisis la clé :
                  </p>
                  <code className="block text-xs break-all bg-[#FDFBF7] border border-[#E8DFD3] rounded px-2 py-1.5 mb-3">
                    {enroll.secret}
                  </code>
                  <label className="block text-xs font-semibold text-[#8A6B4D] mb-1">
                    Code à 6 chiffres généré par l&apos;app
                  </label>
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" className={input} autoFocus />
                  <div className="flex gap-2 mt-3">
                    <GhostButton onClick={() => setEnroll(null)} disabled={busy}>Annuler</GhostButton>
                    <PrimaryButton onClick={confirmEnroll} disabled={busy || code.trim().length < 6}>
                      {busy ? "Vérification…" : "Activer"}
                    </PrimaryButton>
                  </div>
                </div>
              </div>
            ) : mfaEnabled ? (
              disabling ? (
                <div className="max-w-xs">
                  <label className="block text-xs font-semibold text-[#8A6B4D] mb-1">
                    Code (TOTP ou de secours) pour désactiver
                  </label>
                  <input value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="123456" className={input} autoFocus />
                  <div className="flex gap-2 mt-3">
                    <GhostButton onClick={() => setDisabling(false)} disabled={busy}>Annuler</GhostButton>
                    <GhostButton tone="danger" onClick={doDisable} disabled={busy || disableCode.trim().length < 6}>
                      {busy ? "…" : "Désactiver"}
                    </GhostButton>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-[#5A4634] mb-3">
                    Ton compte est protégé par un code à usage unique à chaque connexion.
                  </p>
                  <GhostButton tone="danger" onClick={() => setDisabling(true)}>Désactiver</GhostButton>
                </div>
              )
            ) : (
              <div>
                <p className="text-sm text-[#5A4634] mb-3">
                  Ajoute un second facteur : un mot de passe volé ne suffira plus pour entrer.
                </p>
                <PrimaryButton onClick={startEnroll} disabled={busy}>
                  <KeyRound className="w-4 h-4" /> {busy ? "…" : "Activer l'authentificateur"}
                </PrimaryButton>
              </div>
            )}
          </Card>

          {/* ── Policy: require MFA for all staff (admin only) ─────────────── */}
          {isAdmin ? (
            <Card className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold text-[#1A0F0A]">Exiger l&apos;authentificateur pour tout le staff</h3>
                  <p className="text-sm text-[#8A6B4D] mt-1 max-w-xl">
                    Une fois activé, aucun admin ou modérateur ne peut se connecter sans TOTP.
                    {!mfaEnabled
                      ? " Active d'abord TON authentificateur ci-dessus — sinon tu te bloqueras à la prochaine connexion."
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={required}
                  disabled={busy || (!required && !mfaEnabled)}
                  onClick={() => toggleRequired(!required)}
                  className={`relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-40 ${
                    required ? "bg-[#15803D]" : "bg-[#D9CBB8]"
                  }`}
                  title={!required && !mfaEnabled ? "Active ton authentificateur d'abord" : undefined}
                >
                  <span
                    className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
                      required ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
            </Card>
          ) : null}

          {/* ── Support override: see everyone / every profile (admin only) ── */}
          {isAdmin ? (
            <Card className="p-5 border border-amber-300/60 bg-amber-50/40">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold text-[#1A0F0A] flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    Visibilité totale (support)
                  </h3>
                  <p className="text-sm text-[#8A6B4D] mt-1 max-w-xl">
                    Quand c&apos;est activé, <strong>ton compte admin</strong> voit{" "}
                    <strong>tous les membres sur la carte</strong> (même ceux qui n&apos;ont pas
                    activé leur visibilité) et peut <strong>ouvrir n&apos;importe quel profil</strong>,
                    même privé — pour résoudre des problèmes à la demande.
                  </p>
                  <p className="text-xs text-amber-700 mt-2 max-w-xl">
                    ⚠️ Contourne la vie privée des membres. À n&apos;activer que le temps d&apos;une
                    intervention, puis à <strong>remettre sur OFF</strong>. Réservé au rôle admin ;
                    l&apos;action est tracée.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={fullVis}
                  disabled={busy}
                  onClick={() => toggleFullVis(!fullVis)}
                  className={`relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-40 ${
                    fullVis ? "bg-amber-500" : "bg-[#D9CBB8]"
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
                      fullVis ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </section>
  );
}
