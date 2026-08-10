"use client";

// Panneau latéral ouvert au clic sur un marqueur : qui est ce membre, et quoi
// faire de lui tout de suite. Les données de la liste s'affichent
// immédiatement, la fiche détaillée (email, téléphone, parrain…) se charge
// par-dessus — l'admin n'attend pas un aller-retour pour savoir sur qui il a
// cliqué.

import { useEffect, useRef, useState } from "react";
import {
  Award,
  BadgeCheck,
  Ban,
  Crosshair,
  ExternalLink,
  LogOut,
  MapPin,
  Phone,
  ShieldAlert,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import {
  AdminApiError,
  fetchMapUser,
  forceLogoutUser,
  setAmbassador,
  setUserStatus,
  type MapUser,
  type MapUserDetail,
} from "@/lib/adminApi";
import {
  Avatar,
  Card,
  ErrorBanner,
  formatDate,
  Skeleton,
  StatusChip,
  type ChipTone,
} from "../ui";
import { placeLabel } from "./countryNames";

const STATUS_TONE: Record<string, ChipTone> = {
  active: "green",
  suspended: "amber",
  banned: "red",
};
const STATUS_LABEL: Record<string, string> = {
  active: "Actif",
  suspended: "Suspendu",
  banned: "Banni",
};
const IDENTITY_TONE: Record<string, ChipTone> = {
  approved: "green",
  pending: "amber",
  rejected: "red",
  not_submitted: "neutral",
};
const IDENTITY_LABEL: Record<string, string> = {
  approved: "Identité vérifiée",
  pending: "Identité en attente",
  rejected: "Identité rejetée",
  not_submitted: "Identité non soumise",
};
const PRIVACY_LABEL: Record<string, string> = {
  public: "Profil public",
  friends: "Profil réservé aux amis",
  private: "Profil privé",
};

const FIELD =
  "w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50";

/** Une action en attente de confirmation explicite. */
interface PendingAction {
  key: string;
  title: string;
  description: string;
  confirmLabel: string;
  danger: boolean;
  /** Motif obligatoire — l'API l'exige pour suspendre/bannir. */
  requiresReason: boolean;
  run: (reason: string) => Promise<Partial<MapUser>>;
}

export default function UserPanel({
  user,
  isAdmin,
  onClose,
  onChanged,
  onOpenFullProfile,
}: {
  user: MapUser;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: (patch: Partial<MapUser> & { id: string }) => void;
  onOpenFullProfile: (userId: string) => void;
}) {
  const [detail, setDetail] = useState<MapUserDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    setPending(null);
    setActionError(null);
    setActionMsg(null);
    fetchMapUser(user.id, controller.signal)
      .then(setDetail)
      .catch((e) => {
        if (controller.signal.aborted) return;
        setDetailError(
          e instanceof AdminApiError ? e.message : "Fiche indisponible.",
        );
      });
    return () => controller.abort();
  }, [user.id]);

  // Sur mobile le panneau est sous la carte : sans ça, cliquer un marqueur
  // n'aurait aucun effet visible.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [user.id]);

  function ask(action: PendingAction) {
    setPending(action);
    setReason("");
    setActionError(null);
    setActionMsg(null);
  }

  async function confirm() {
    if (!pending) return;
    const trimmed = reason.trim();
    if (pending.requiresReason && trimmed.length < 5) {
      setActionError("Un motif est requis pour cette action.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const patch = await pending.run(trimmed);
      onChanged({ ...patch, id: user.id });
      setDetail((d) => (d ? { ...d, ...patch } : d));
      setActionMsg("Action appliquée.");
      setPending(null);
    } catch (e) {
      setActionError(
        e instanceof AdminApiError ? e.message : "Action impossible.",
      );
    } finally {
      setBusy(false);
    }
  }

  const name = fullName(user);
  const place = placeLabel(user.city, user.countryCode);
  const precise = user.precision === "gps";

  return (
    <Card className="p-4">
      <div ref={panelRef} className="scroll-mt-4">
        <div className="flex items-start gap-3">
          <Avatar src={user.avatarUrl} name={name} size={48} />
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-[#1A0F0A] truncate">{name}</h3>
            <p className="text-xs text-[#8A6B4D] truncate">
              {place || "Ville inconnue"}
              {" · "}
              {user.side === "niger" ? "Au Niger" : "Diaspora"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la fiche"
            className="grid place-items-center w-8 h-8 rounded-lg text-[#5A4634] hover:bg-[#F1E9DD] shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          <StatusChip tone={STATUS_TONE[user.status] ?? "neutral"}>
            {STATUS_LABEL[user.status] ?? user.status}
          </StatusChip>
          <StatusChip
            tone={IDENTITY_TONE[user.identityStatus] ?? "neutral"}
            icon={user.identityStatus === "approved" ? BadgeCheck : undefined}
          >
            {IDENTITY_LABEL[user.identityStatus] ?? user.identityStatus}
          </StatusChip>
          {user.isAmbassador ? (
            <StatusChip tone="brand" icon={Award}>
              Ambassadeur
            </StatusChip>
          ) : null}
          <StatusChip tone={user.emailVerified ? "green" : "neutral"}>
            {user.emailVerified ? "Email vérifié" : "Email non vérifié"}
          </StatusChip>
          <StatusChip tone={user.phoneVerified ? "green" : "neutral"} icon={Phone}>
            {user.phoneVerified ? "Tél. vérifié" : "Tél. non vérifié"}
          </StatusChip>
          <StatusChip tone="neutral">
            {PRIVACY_LABEL[user.privacyLevel] ?? user.privacyLevel}
          </StatusChip>
        </div>

        {/* Provenance de la position — jamais présentée comme une adresse. */}
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            precise
              ? "border-[#F5C2C2] bg-[#FCE8E8] text-[#8B1F1F]"
              : "border-[#E8DFD3] bg-[#FDFBF7] text-[#5A4634]"
          }`}
        >
          <p className="flex items-center gap-1.5 font-semibold">
            {precise ? (
              <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {positionTitle(user)}
          </p>
          <p className="mt-0.5">
            {positionDetail(user)}
            {user.positionUpdatedAt
              ? ` Mise à jour le ${formatDate(user.positionUpdatedAt)}.`
              : ""}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3">
          <Stat label="Posts" value={user.counts.posts} />
          <Stat label="Amis" value={user.counts.friends} />
          <Stat
            label="Filleuls"
            value={detail ? detail.inviteesCount : null}
          />
        </div>

        <dl className="mt-3 rounded-lg border border-[#E8DFD3] bg-white p-3 text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-[#8A6B4D]">Dernière activité</dt>
          <dd className="text-[#1A0F0A] text-right">
            {user.lastSeenAt ? formatDate(user.lastSeenAt) : "Jamais vue"}
          </dd>
          <dt className="text-[#8A6B4D]">Inscription</dt>
          <dd className="text-[#1A0F0A] text-right">
            {formatDate(user.createdAt)}
          </dd>
          <dt className="text-[#8A6B4D]">Dernière connexion</dt>
          <dd className="text-[#1A0F0A] text-right">
            {detail ? (detail.lastLoginAt ? formatDate(detail.lastLoginAt) : "—") : <InlineSkeleton />}
          </dd>
          <dt className="text-[#8A6B4D]">Email</dt>
          <dd className="text-[#1A0F0A] text-right break-all">
            {detail ? (detail.email ?? "—") : <InlineSkeleton />}
          </dd>
          <dt className="text-[#8A6B4D]">Téléphone</dt>
          <dd className="text-[#1A0F0A] text-right break-all">
            {detail ? (detail.phone ?? "—") : <InlineSkeleton />}
          </dd>
          <dt className="text-[#8A6B4D]">Parrain</dt>
          <dd className="text-[#1A0F0A] text-right truncate">
            {detail ? (detail.invitedBy?.displayName ?? "—") : <InlineSkeleton />}
          </dd>
          {detail?.languages && detail.languages.length > 0 ? (
            <>
              <dt className="text-[#8A6B4D]">Langues</dt>
              <dd className="text-[#1A0F0A] text-right">
                {detail.languages.join(", ")}
              </dd>
            </>
          ) : null}
        </dl>

        {detail?.bio ? (
          <p className="mt-3 rounded-lg border border-[#E8DFD3] bg-white p-3 text-sm text-[#5A4634] whitespace-pre-wrap break-words">
            {detail.bio}
          </p>
        ) : null}

        {detailError ? (
          <div className="mt-3">
            <ErrorBanner message={detailError} />
          </div>
        ) : null}

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        <div className="mt-4 border-t border-[#E8DFD3] pt-3">
          <p className="text-xs font-semibold text-[#8A6B4D] mb-2">
            Agir sur ce compte
          </p>
          <div className="flex flex-wrap gap-1.5">
            {user.status === "active" ? (
              <ActionButton
                tone="amber"
                icon={UserX}
                label="Suspendre"
                disabled={busy}
                onClick={() =>
                  ask({
                    key: "suspend",
                    title: `Suspendre ${name} ?`,
                    description:
                      "Le compte ne pourra plus se connecter tant que la suspension n'est pas levée. Le motif lui est communiqué.",
                    confirmLabel: "Suspendre",
                    danger: true,
                    requiresReason: true,
                    run: async (r) => {
                      const res = await setUserStatus(user.id, "suspended", {
                        reason: r,
                      });
                      return { status: res.status };
                    },
                  })
                }
              />
            ) : (
              <ActionButton
                tone="green"
                icon={UserCheck}
                label="Réactiver"
                disabled={busy}
                onClick={() =>
                  ask({
                    key: "reactivate",
                    title: `Réactiver ${name} ?`,
                    description:
                      "Le compte retrouve immédiatement l'accès à l'application.",
                    confirmLabel: "Réactiver",
                    danger: false,
                    requiresReason: false,
                    run: async () => {
                      const res = await setUserStatus(user.id, "active");
                      return { status: res.status };
                    },
                  })
                }
              />
            )}

            {user.status !== "banned" ? (
              <ActionButton
                tone="red"
                icon={Ban}
                label="Bannir"
                disabled={busy}
                onClick={() =>
                  ask({
                    key: "ban",
                    title: `Bannir ${name} ?`,
                    description:
                      "Bannissement permanent jusqu'à levée manuelle. À réserver aux cas graves.",
                    confirmLabel: "Bannir",
                    danger: true,
                    requiresReason: true,
                    run: async (r) => {
                      const res = await setUserStatus(user.id, "banned", {
                        reason: r,
                      });
                      return { status: res.status };
                    },
                  })
                }
              />
            ) : null}

            <ActionButton
              tone="brand"
              icon={Award}
              label={
                user.isAmbassador ? "Retirer ambassadeur" : "Badge ambassadeur"
              }
              disabled={busy}
              onClick={() =>
                ask({
                  key: "ambassador",
                  title: user.isAmbassador
                    ? `Retirer le badge ambassadeur à ${name} ?`
                    : `Donner le badge ambassadeur à ${name} ?`,
                  description: user.isAmbassador
                    ? "Le badge disparaîtra de son profil et de la carte."
                    : "Le badge sera visible de toute la communauté.",
                  confirmLabel: user.isAmbassador ? "Retirer" : "Attribuer",
                  danger: user.isAmbassador,
                  requiresReason: false,
                  run: async () => {
                    const res = await setAmbassador(
                      user.id,
                      !user.isAmbassador,
                    );
                    return { isAmbassador: res.isAmbassador };
                  },
                })
              }
            />

            {isAdmin ? (
              <ActionButton
                tone="amber"
                icon={LogOut}
                label="Déconnecter partout"
                disabled={busy}
                onClick={() =>
                  ask({
                    key: "logout",
                    title: `Déconnecter ${name} de tous ses appareils ?`,
                    description:
                      "Toutes les sessions actives sont révoquées. Le membre devra se reconnecter.",
                    confirmLabel: "Déconnecter",
                    danger: true,
                    requiresReason: false,
                    run: async () => {
                      const res = await forceLogoutUser(user.id);
                      setActionMsg(`${res.revoked} session(s) révoquée(s).`);
                      return {};
                    },
                  })
                }
              />
            ) : null}
          </div>

          {pending ? (
            <div className="mt-3 rounded-lg border border-[#E8DFD3] bg-[#FFF8F3] p-3">
              <p className="flex items-start gap-1.5 text-sm font-bold text-[#1A0F0A]">
                <ShieldAlert
                  className="w-4 h-4 mt-0.5 shrink-0 text-[#B45309]"
                  aria-hidden="true"
                />
                {pending.title}
              </p>
              <p className="text-xs text-[#5A4634] mt-1">
                {pending.description}
              </p>
              {pending.requiresReason ? (
                <textarea
                  className={`${FIELD} mt-2 min-h-[64px] resize-y`}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Motif (obligatoire, communiqué au membre)"
                  aria-label="Motif de la sanction"
                />
              ) : null}
              {actionError ? (
                <p className="text-xs text-[#B91C1C] mt-2">{actionError}</p>
              ) : null}
              <div className="flex justify-end gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  disabled={busy}
                  className="rounded-lg border border-[#E8DFD3] px-3 py-1.5 text-xs font-semibold text-[#5A4634] hover:bg-white disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={confirm}
                  disabled={busy}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                    pending.danger
                      ? "bg-[#B91C1C] hover:bg-[#8B1F1F]"
                      : "bg-[#15803D] hover:bg-[#116932]"
                  }`}
                >
                  {busy ? "…" : pending.confirmLabel}
                </button>
              </div>
            </div>
          ) : null}

          {!pending && actionError ? (
            <p className="text-xs text-[#B91C1C] mt-2">{actionError}</p>
          ) : null}
          {!pending && actionMsg ? (
            <p className="text-xs text-[#15803D] mt-2">{actionMsg}</p>
          ) : null}

          <button
            type="button"
            onClick={() => onOpenFullProfile(user.id)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#E05206] hover:underline"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            Ouvrir la fiche complète
          </button>
        </div>
      </div>
    </Card>
  );
}

/**
 * Ce que vaut le point, dit en clair. Deux axes à ne pas confondre :
 * `precision` ('city' | 'gps') dit à quel point c'est précis, `positionSource`
 * dit d'où ça vient. Un point posé au centre du Niger parce qu'on ne sait rien
 * de plus ne doit jamais se lire comme « ce membre est à Niamey ».
 */
function positionTitle(user: MapUser): string {
  if (user.precision === null) return "Aucune position connue";
  if (user.precision === "gps")
    return "Position GPS réelle (bris de glace actif)";
  if (user.positionSource === "country") return "Position déduite du pays";
  if (user.positionSource === "city") return "Position déduite de la ville";
  return "Position approximative";
}

function positionDetail(user: MapUser): string {
  if (user.precision === null) return "Ce membre n'apparaît pas sur la carte.";
  if (user.precision === "gps")
    return "Coordonnées transmises par l'appareil du membre.";
  if (user.positionSource === "country")
    return "Le membre n'a pas renseigné sa position : le point est le centre de son pays. Il ne dit rien de sa ville, encore moins de son adresse.";
  if (user.positionSource === "city")
    return "Le membre n'a pas renseigné sa position : le point est le centre de la ville qu'il a déclarée.";
  return "Centroïde de la ville déclarée + décalage aléatoire : ce n'est pas une adresse.";
}

function fullName(u: {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  const n =
    u.displayName ?? [u.firstName, u.lastName].filter(Boolean).join(" ");
  return n || "Membre sans nom";
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-[#EDE3D6] bg-white px-3 py-2 text-center">
      <p className="text-lg font-bold text-[#1A0F0A] tabular-nums">
        {value === null ? "—" : value.toLocaleString("fr-FR")}
      </p>
      <p className="text-xs text-[#8A6B4D]">{label}</p>
    </div>
  );
}

function InlineSkeleton() {
  return <Skeleton className="inline-block h-3 w-24 align-middle" />;
}

const ACTION_TONES: Record<string, string> = {
  amber: "border-[#E8DFD3] text-[#B45309] hover:bg-[#FEF3E2]",
  red: "border-[#F5C2C2] text-[#B91C1C] hover:bg-[#FCE8E8]",
  green: "border-[#E8DFD3] text-[#15803D] hover:bg-[#E7F4EC]",
  brand: "border-[#E8DFD3] text-[#E05206] hover:bg-[#FDF0E6]",
};

function ActionButton({
  tone,
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  tone: keyof typeof ACTION_TONES;
  icon: typeof Award;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50 ${ACTION_TONES[tone]}`}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
