"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  Globe2,
  Lock,
  Unlock,
} from "lucide-react";
import {
  mfaStatus,
  mfaEnroll,
  mfaConfirm,
  mfaDisable,
  fetchAdminSettings,
  patchAdminSettings,
  fetchFullVisibilityLog,
  AdminApiError,
  type AdminRole,
  type AdminAccessLogRow,
} from "@/lib/adminApi";
import { Card, ErrorBanner, GhostButton, PrimaryButton, Skeleton, StatusChip } from "./ui";

type EnrollState = { secret: string; otpauthUrl: string; qr: string } | null;

export default function SecuritySection({ role }: { role: AdminRole | null }) {
  const isAdmin = role === "admin";
  const [loading, setLoading] = useState(true);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [required, setRequired] = useState(false);
  const [fullVis, setFullVis] = useState(false);
  const [fullVisUntil, setFullVisUntil] = useState<string | null>(null);
  const [globalVis, setGlobalVis] = useState(false);
  // Règle diaspora — trois interrupteurs indépendants (voir DiasporaPolicyService).
  const [diasporaContact, setDiasporaContact] = useState(true);
  const [diasporaSplit, setDiasporaSplit] = useState(true);
  const [diasporaUnknown, setDiasporaUnknown] = useState(true);
  // Plafond hebdomadaire des publications d'animation, tous comptes confondus.
  const [animCap, setAnimCap] = useState(10);
  const [animCapDraft, setAnimCapDraft] = useState("10");
  const [accessLog, setAccessLog] = useState<AdminAccessLogRow[]>([]);
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
        setFullVisUntil(settings.adminFullVisibilityUntil);
        setGlobalVis(settings.globalFullVisibility);
        setDiasporaContact(settings.diasporaContactRestriction);
        setDiasporaSplit(settings.diasporaContentSplit);
        setDiasporaUnknown(settings.diasporaUnknownCountryRestricted);
        setAnimCap(settings.animationPostsPerWeekCap);
        setAnimCapDraft(String(settings.animationPostsPerWeekCap));
        if (isAdmin) {
          fetchFullVisibilityLog(20)
            .then(setAccessLog)
            .catch(() => setAccessLog([]));
        }
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
      setFullVisUntil(s.adminFullVisibilityUntil);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Mise à jour impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleGlobalVis(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const s = await patchAdminSettings({ globalFullVisibility: next });
      setGlobalVis(s.globalFullVisibility);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Mise à jour impossible.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Les trois réglages diaspora partagent un seul chemin : le PATCH renvoie
   * l'état complet, on réaligne donc les trois à chaque fois plutôt que de
   * supposer que seul celui qu'on a touché a bougé.
   */
  async function toggleDiaspora(
    key:
      | "diasporaContactRestriction"
      | "diasporaContentSplit"
      | "diasporaUnknownCountryRestricted",
    next: boolean,
  ) {
    setBusy(true);
    setError(null);
    try {
      const s = await patchAdminSettings({ [key]: next });
      setDiasporaContact(s.diasporaContactRestriction);
      setDiasporaSplit(s.diasporaContentSplit);
      setDiasporaUnknown(s.diasporaUnknownCountryRestricted);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Mise à jour impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAnimCap() {
    const next = Number.parseInt(animCapDraft, 10);
    if (!Number.isFinite(next) || next < 0 || next > 200) {
      setError("Le plafond doit être un nombre entre 0 et 200.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = await patchAdminSettings({ animationPostsPerWeekCap: next });
      setAnimCap(s.animationPostsPerWeekCap);
      setAnimCapDraft(String(s.animationPostsPerWeekCap));
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Enregistrement impossible.");
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

              {fullVis && fullVisUntil ? (
                <p className="text-xs font-semibold text-amber-700 mt-3">
                  Actif — expire automatiquement à{" "}
                  {new Date(fullVisUntil).toLocaleString("fr-FR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    day: "2-digit",
                    month: "short",
                  })}
                  .
                </p>
              ) : null}

              {accessLog.length > 0 ? (
                <div className="mt-4 border-t border-[#E8DFD3] pt-3">
                  <p className="text-xs font-semibold text-[#8A6B4D] mb-2">
                    Derniers accès en visibilité totale
                  </p>
                  <ul className="space-y-1 max-h-48 overflow-auto">
                    {accessLog.map((r) => (
                      <li key={r.id} className="text-xs text-[#5A4634] flex justify-between gap-3">
                        <span>
                          {r.action === "map_full_visibility"
                            ? "🗺️ Carte (tout le monde)"
                            : `👤 Profil ${r.targetId?.slice(0, 8) ?? ""}`}
                        </span>
                        <span className="text-[#8A6B4D] tabular-nums shrink-0">
                          {new Date(r.createdAt).toLocaleString("fr-FR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            day: "2-digit",
                            month: "short",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Card>
          ) : null}

          {/* ── Community-wide visibility: everyone sees everyone (admin only) ── */}
          {isAdmin ? (
            <Card className="p-5 border border-sky-300/60 bg-sky-50/40">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold text-[#1A0F0A] flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-sky-600" />
                    Visibilité communautaire (tout le monde voit tout le monde)
                  </h3>
                  <p className="text-sm text-[#8A6B4D] mt-1 max-w-xl">
                    Quand c&apos;est activé, <strong>tous les membres</strong> voient{" "}
                    <strong>tous les profils</strong> — y compris les profils privés — dans la
                    recherche, sur la carte, le feed et les listes d&apos;amis. Le choix{" "}
                    <strong>« me montrer sur la carte »</strong> et la visibilité choisie{" "}
                    <strong>par publication</strong> restent respectés.
                  </p>
                  <p className="text-xs text-sky-700 mt-2 max-w-xl">
                    Sur OFF (défaut), chaque membre garde le contrôle de la visibilité de son
                    profil, comme aujourd&apos;hui. Effet immédiat, sans redéploiement.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={globalVis}
                  disabled={busy}
                  onClick={() => toggleGlobalVis(!globalVis)}
                  className={`relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-40 ${
                    globalVis ? "bg-sky-500" : "bg-[#D9CBB8]"
                  }`}
                >
                  <span
                    className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
                      globalVis ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
            </Card>
          ) : null}

          {isAdmin ? (
            <Card>
              <div className="mb-4">
                <h3 className="font-bold text-[#1A0F0A] flex items-center gap-1.5">
                  <Globe2 className="w-4 h-4 text-emerald-600" />
                  Règle diaspora
                </h3>
                <p className="text-sm text-[#8A6B4D] mt-1 max-w-2xl">
                  Trois réglages <strong>indépendants</strong> : en lever un ne lève
                  pas les autres. Effet immédiat, sans redéploiement. Un membre
                  compte comme résidant au Niger si son pays est <strong>NE</strong>.
                </p>
              </div>

              {/* Etat combine, avant le detail : c'est la question qu'on se pose en
                  ouvrant la page — qu'est-ce qui s'applique en ce moment. */}
              <div className="flex flex-wrap items-center gap-2 mb-4 rounded-lg bg-[#FFF8F3] border border-[#E8DFD3] px-3 py-2">
                <span className="text-xs font-semibold text-[#8A6B4D]">
                  En vigueur :
                </span>
                {[
                  { on: diasporaContact, label: "Contact limité" },
                  { on: diasporaSplit, label: "Fils séparés" },
                  { on: diasporaUnknown, label: "Pays vide = Niger" },
                ].map((r) => (
                  <span
                    key={r.label}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      r.on
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-[#EFE6DA] text-[#8A6B4D] line-through decoration-[#C9B79E]"
                    }`}
                  >
                    {r.on ? (
                      <Lock className="w-3 h-3" aria-hidden="true" />
                    ) : (
                      <Unlock className="w-3 h-3" aria-hidden="true" />
                    )}
                    {r.label}
                  </span>
                ))}
              </div>

              <div className="space-y-3">
                <DiasporaToggle
                  title="Limiter la prise de contact"
                  scope="Demandes d'ami et premiers messages · sens unique"
                  checked={diasporaContact}
                  busy={busy}
                  onChange={(v) => toggleDiaspora("diasporaContactRestriction", v)}
                >
                  Un membre au Niger ne peut ni envoyer une demande d&apos;ami ni écrire le
                  premier à un membre de la diaspora. <strong>Sens unique</strong> : la
                  diaspora garde le droit d&apos;écrire au pays, et le membre au Niger peut
                  alors répondre. Les amitiés et conversations déjà existantes sont
                  conservées.
                </DiasporaToggle>

                <DiasporaToggle
                  title="Séparer les contenus"
                  scope="Publications, stories, commentaires, réactions, sondages, avis · symétrique"
                  checked={diasporaSplit}
                  busy={busy}
                  onChange={(v) => toggleDiaspora("diasporaContentSplit", v)}
                >
                  Chaque camp ne voit que ses propres publications, stories, commentaires,
                  réactions, sondages et avis. <strong>Symétrique</strong>, contrairement au
                  réglage ci-dessus. Les <strong>profils, la recherche et la carte</strong>{" "}
                  ne sont jamais filtrés, ni les <strong>services</strong> et les{" "}
                  <strong>associations</strong>. Sur OFF, les deux fils n&apos;en font
                  qu&apos;un.
                </DiasporaToggle>

                <DiasporaToggle
                  title="Traiter un pays non renseigné comme le Niger"
                  scope="Uniquement les profils sans pays renseigné"
                  checked={diasporaUnknown}
                  busy={busy}
                  onChange={(v) => toggleDiaspora("diasporaUnknownCountryRestricted", v)}
                >
                  Ne concerne que les membres qui n&apos;ont <strong>aucun pays</strong> sur
                  leur profil. Sur ON, ils sont restreints, ce qui ferme le contournement
                  évident (laisser le champ vide) mais retient aussi les inscriptions par
                  Google/Apple qui sautent le formulaire. Sur OFF, ils sont traités comme la
                  diaspora.
                </DiasporaToggle>
              </div>
            </Card>
          ) : null}

          {isAdmin ? (
            <Card>
              <h3 className="text-sm font-bold text-[#1A0F0A]">
                Publications d&apos;animation — plafond hebdomadaire
              </h3>
              <p className="mt-2 text-sm text-[#5A4634] leading-relaxed">
                Nombre maximum de publications d&apos;animation par semaine glissante,{" "}
                <strong>tous comptes confondus</strong>. Le quota de chaque compte ne
                descend pas sous une publication par semaine : avec vingt-cinq comptes
                actifs, ce plafond est le seul réglage qui passe sous vingt-cinq. Le
                surplus est <strong>reporté</strong>, jamais perdu — la file se vide plus
                lentement, rien n&apos;est jeté. <strong>0</strong> arrête toute
                publication d&apos;animation, sans toucher aux commentaires ni aux
                réponses.
              </p>
              <div className="mt-4 flex items-center gap-3">
                <label htmlFor="anim-cap" className="text-sm text-[#5A4634]">
                  Plafond
                </label>
                <input
                  id="anim-cap"
                  type="number"
                  min={0}
                  max={200}
                  value={animCapDraft}
                  onChange={(e) => setAnimCapDraft(e.target.value)}
                  disabled={busy}
                  className="w-24 rounded-lg border border-[#E8DFD3] px-3 py-2 text-sm text-[#1A0F0A]"
                />
                <span className="text-sm text-[#8A6B4D]">publications / semaine</span>
                <button
                  type="button"
                  onClick={() => void saveAnimCap()}
                  disabled={busy || animCapDraft === String(animCap)}
                  className="rounded-lg bg-[#E05206] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Enregistrer
                </button>
              </div>
            </Card>
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * Un interrupteur de la carte « Règle diaspora ».
 *
 * Chaque regle est une vignette autonome plutot qu'une ligne dans un mur de
 * texte : le titre, l'etat ECRIT (« Appliquee » / « Levee ») et la portee sont
 * lisibles sans lire le paragraphe. L'etat ne repose jamais sur la seule
 * position du curseur ni sur la couleur — les trois reglages etant
 * independants, confondre lequel est actif est l'erreur qui coute cher.
 */
function DiasporaToggle({
  title,
  scope,
  checked,
  busy,
  onChange,
  children,
}: {
  title: string;
  /** Une ligne : ce que la regle touche, avant tout paragraphe. */
  scope: string;
  checked: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
}) {
  const id = title.replace(/\W+/g, "-").toLowerCase();
  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        checked
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-[#E8DFD3] bg-[#FFF8F3]/60"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-[#1A0F0A] text-sm">{title}</p>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                checked
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-[#EFE6DA] text-[#8A6B4D]"
              }`}
            >
              {checked ? (
                <Lock className="w-3 h-3" aria-hidden="true" />
              ) : (
                <Unlock className="w-3 h-3" aria-hidden="true" />
              )}
              {checked ? "Appliquée" : "Levée"}
            </span>
          </div>
          <p className="text-xs font-medium text-[#8A6B4D] mt-1">{scope}</p>
        </div>

        <button
          type="button"
          role="switch"
          aria-label={title}
          aria-checked={checked}
          aria-describedby={`${id}-desc`}
          disabled={busy}
          onClick={() => onChange(!checked)}
          className={`relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-40 ${
            checked ? "bg-emerald-500" : "bg-[#D9CBB8]"
          }`}
        >
          <span
            className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${
              checked ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      <p
        id={`${id}-desc`}
        className="text-[13px] leading-relaxed text-[#8A6B4D] mt-2.5 max-w-2xl"
      >
        {children}
      </p>
    </div>
  );
}
