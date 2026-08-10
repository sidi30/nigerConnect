"use client";

// Bris de glace « position précise ».
//
// Par défaut la carte ne montre que des positions approximatives. Voir la
// position GPS réelle d'un membre est une mesure exceptionnelle : elle exige un
// code authenticator + un motif écrit, ne dure que 30 minutes et laisse une
// trace nominative dans le journal d'audit. L'interface doit le dire, pas le
// sous-entendre.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Crosshair, ShieldAlert, X } from "lucide-react";
import {
  AdminApiError,
  openPreciseLocationWindow,
  type PreciseLocationWindow,
} from "@/lib/adminApi";
import { Card, ErrorBanner, GhostButton, Modal, PrimaryButton } from "../ui";

const FIELD =
  "w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50";
const LABEL = "block text-xs font-semibold text-[#8A6B4D] mb-1";

/** En dessous, un motif ne dit rien d'exploitable dans un journal d'audit. */
const MIN_REASON = 10;

/**
 * Secondes restantes avant `until`, recalculées chaque seconde.
 * Renvoie 0 quand la fenêtre est fermée ou échue.
 */
export function useRemainingSeconds(
  until: string | null,
  onExpire: () => void,
): number {
  const [remaining, setRemaining] = useState(() => secondsUntil(until));
  // L'expiration ne doit déclencher le rechargement qu'une fois, et le handler
  // change à chaque rendu du parent : on le lit dans une ref.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!until) {
      setRemaining(0);
      return;
    }
    setRemaining(secondsUntil(until));
    const id = window.setInterval(() => {
      const left = secondsUntil(until);
      setRemaining(left);
      if (left <= 0) {
        window.clearInterval(id);
        onExpireRef.current();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [until]);

  return remaining;
}

function secondsUntil(until: string | null): number {
  if (!until) return 0;
  const ms = Date.parse(until) - Date.now();
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.ceil(ms / 1000));
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Bandeau permanent tant que la fenêtre est ouverte
// ---------------------------------------------------------------------------

export function PreciseLocationBanner({
  remaining,
  onRevoke,
  revoking,
}: {
  remaining: number;
  onRevoke: () => void;
  revoking: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-[#F5C2C2] bg-[#FCE8E8] px-4 py-3 flex flex-wrap items-center gap-3"
    >
      <ShieldAlert
        className="w-5 h-5 text-[#B91C1C] shrink-0"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-[16rem]">
        <p className="text-sm font-bold text-[#8B1F1F]">
          Positions GPS réelles affichées
        </p>
        <p className="text-xs text-[#8B1F1F]">
          Accès exceptionnel, journalisé à ton nom. Fermeture automatique dans{" "}
          <span className="font-bold tabular-nums">
            {formatCountdown(remaining)}
          </span>
          .
        </p>
      </div>
      <button
        type="button"
        onClick={onRevoke}
        disabled={revoking}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[#B91C1C] px-3 py-2 text-sm font-semibold text-white hover:bg-[#8B1F1F] disabled:opacity-50"
      >
        <X className="w-4 h-4" aria-hidden="true" />
        {revoking ? "Fermeture…" : "Révoquer maintenant"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Interrupteur (en-tête de la carte)
// ---------------------------------------------------------------------------

export function PreciseLocationToggle({
  active,
  onOpen,
  onRevoke,
  busy,
}: {
  active: boolean;
  onOpen: () => void;
  onRevoke: () => void;
  busy: boolean;
}) {
  return (
    <GhostButton
      onClick={active ? onRevoke : onOpen}
      disabled={busy}
      tone={active ? "danger" : "neutral"}
    >
      <Crosshair className="w-4 h-4 inline mr-1.5" aria-hidden="true" />
      {active ? "Repasser en position ville" : "Position précise…"}
    </GhostButton>
  );
}

// ---------------------------------------------------------------------------
// Boîte de dialogue d'ouverture
// ---------------------------------------------------------------------------

export function PreciseLocationDialog({
  onClose,
  onOpened,
}: {
  onClose: () => void;
  onOpened: (window: PreciseLocationWindow) => void;
}) {
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    const trimmedReason = reason.trim();
    // L'API n'accepte que 6 chiffres (pas de code de secours : c'est une
    // bouée de connexion, pas une clé de surveillance) et compte les échecs.
    // Autant refuser ici plutôt que de brûler une tentative.
    if (!/^\d{6}$/.test(code)) {
      setError("Saisis le code à 6 chiffres de ton application authenticator.");
      return;
    }
    if (trimmedReason.length < MIN_REASON) {
      setError(
        `Le motif est obligatoire et doit être explicite (${MIN_REASON} caractères minimum).`,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await openPreciseLocationWindow(code, trimmedReason);
      onOpened({ active: true, until: res.until });
    } catch (e) {
      setError(
        e instanceof AdminApiError
          ? e.message
          : "Ouverture de l'accès impossible.",
      );
      setSubmitting(false);
    }
  }

  return (
    // <Modal> rend en portail au-dessus de Leaflet : posee ici en `fixed z-50`,
    // la fenetre passait DERRIERE la carte et devenait incliquable.
    <Modal onClose={onClose} labelledBy="precise-location-title">
      <Card className="w-full max-w-md p-5">
        <div>
          <div className="flex items-start gap-2.5 mb-4">
            <span className="mt-0.5 grid place-items-center w-8 h-8 rounded-lg bg-[#FCE8E8] text-[#B91C1C] shrink-0">
              <AlertTriangle size={18} strokeWidth={2} aria-hidden="true" />
            </span>
            <div>
              <h3
                id="precise-location-title"
                className="text-lg font-bold text-[#1A0F0A] leading-tight"
              >
                Afficher les positions GPS réelles
              </h3>
              <p className="text-xs text-[#8A6B4D] mt-0.5">
                Mesure exceptionnelle, réservée aux situations qui l&apos;exigent.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-[#E8DFD3] bg-[#FFF8F3] px-3 py-2.5 mb-4 text-xs text-[#5A4634] space-y-1">
            <p>
              L&apos;accès dure <strong>30 minutes</strong> puis se referme tout
              seul.
            </p>
            <p>
              Chaque consultation est <strong>tracée à ton nom</strong> dans le
              journal d&apos;audit, avec le motif saisi ci-dessous.
            </p>
            <p>
              Hors de cette fenêtre, la carte ne montre que des positions
              approximatives (ville).
            </p>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className={LABEL}>Code de l&apos;application authenticator</span>
              <input
                ref={codeRef}
                className={`${FIELD} tracking-[0.3em] font-mono`}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
              />
            </label>

            <label className="block">
              <span className={LABEL}>
                Motif (obligatoire, conservé dans le journal)
              </span>
              <textarea
                className={`${FIELD} min-h-[80px] resize-y`}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex : signalement de harcèlement n°412, besoin de localiser le compte pour la réponse aux autorités"
              />
              <span className="block text-[11px] text-[#8A6B4D] mt-1">
                {reason.trim().length}/{MIN_REASON} caractères minimum
              </span>
            </label>

            {error ? <ErrorBanner message={error} /> : null}
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <GhostButton onClick={onClose} disabled={submitting}>
              Annuler
            </GhostButton>
            <PrimaryButton onClick={submit} disabled={submitting}>
              {submitting ? "Ouverture…" : "Ouvrir l'accès 30 min"}
            </PrimaryButton>
          </div>
        </div>
      </Card>
    </Modal>
  );
}
