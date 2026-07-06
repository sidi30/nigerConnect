"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Award,
  BadgeCheck,
  Ban,
  Info,
  LogOut,
  Pencil,
  Search,
  ShieldOff,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import {
  listAdminUsers,
  setUserStatus,
  updateAdminUser,
  deleteAdminUser,
  fetchUserDetail,
  fetchUserAudit,
  forceLogoutUser,
  resetUserMfa,
  AdminApiError,
  type AdminUser,
  type AdminUserFilters,
  type AdminUserDetail,
  type AdminUserAuditRow,
  type AdminRole,
  type UserStatus,
  type UserRole,
  type IdentityDistStatus,
} from "@/lib/adminApi";
import {
  Avatar,
  Card,
  EmptyState,
  ErrorBanner,
  formatDate,
  GhostButton,
  PrimaryButton,
  Skeleton,
  StatusChip,
  type ChipTone,
} from "./ui";

function fullName(u: {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string {
  const n = u.displayName ?? [u.firstName, u.lastName].filter(Boolean).join(" ");
  return n || u.email || "—";
}

const STATUS_TONE: Record<UserStatus, ChipTone> = {
  active: "green",
  suspended: "amber",
  banned: "red",
};
const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Actif",
  suspended: "Suspendu",
  banned: "Banni",
};
const ROLE_TONE: Record<UserRole, ChipTone> = {
  admin: "brand",
  moderator: "blue",
  user: "neutral",
};

const STATUS_FILTERS: Array<{ id: UserStatus | "all"; label: string }> = [
  { id: "all", label: "Tous" },
  { id: "active", label: "Actifs" },
  { id: "suspended", label: "Suspendus" },
  { id: "banned", label: "Bannis" },
];

const FIELD =
  "w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] focus:outline-none focus:ring-2 focus:ring-amber-400/50";
const LABEL = "block text-xs font-semibold text-[#8A6B4D]";

/** Duration presets for a temporary sanction. `null` = permanent (no expiry). */
const DURATIONS: Array<{ id: string; label: string; ms: number | null }> = [
  { id: "24h", label: "24 heures", ms: 24 * 3_600_000 },
  { id: "7d", label: "7 jours", ms: 7 * 24 * 3_600_000 },
  { id: "30d", label: "30 jours", ms: 30 * 24 * 3_600_000 },
  { id: "permanent", label: "Permanent", ms: null },
];

// ── Sanction modal ─────────────────────────────────────────────────────────────

function SanctionModal({
  user,
  initialStatus,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  initialStatus: Exclude<UserStatus, "active">;
  onClose: () => void;
  onSaved: (patch: Pick<AdminUser, "status" | "statusReason" | "statusExpiresAt">) => void;
}) {
  const [status, setStatus] = useState<Exclude<UserStatus, "active">>(initialStatus);
  const [reason, setReason] = useState("");
  const [durationId, setDurationId] = useState<string>("7d");
  const [customDate, setCustomDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function computeExpiresAt(): string | undefined {
    if (customDate) {
      const t = Date.parse(customDate);
      return Number.isNaN(t) ? undefined : new Date(t).toISOString();
    }
    const preset = DURATIONS.find((d) => d.id === durationId);
    if (!preset || preset.ms === null) return undefined;
    return new Date(Date.now() + preset.ms).toISOString();
  }

  async function save() {
    if (!reason.trim()) {
      setError("Un motif est requis pour suspendre ou bannir un compte.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const expiresAt = computeExpiresAt();
      const res = await setUserStatus(user.id, status, { reason: reason.trim(), expiresAt });
      onSaved({
        status: res.status,
        statusReason: res.statusReason,
        statusExpiresAt: res.statusExpiresAt,
      });
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Action impossible.");
      setSaving(false);
    }
  }

  const hasExpiry = customDate !== "" || DURATIONS.find((d) => d.id === durationId)?.ms != null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5">
        <div onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-[#1A0F0A] mb-4">Sanctionner {fullName(user)}</h3>
          <div className="space-y-3">
            <label className={LABEL}>
              Sanction
              <select
                className={FIELD}
                value={status}
                onChange={(e) => setStatus(e.target.value as Exclude<UserStatus, "active">)}
              >
                <option value="suspended">Suspension</option>
                <option value="banned">Bannissement</option>
              </select>
            </label>
            <label className={LABEL}>
              Motif (obligatoire — communiqué à l&apos;utilisateur)
              <textarea
                className={`${FIELD} min-h-[80px] resize-y`}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex : propos haineux répétés malgré avertissement"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL}>
                Durée
                <select
                  className={FIELD}
                  value={durationId}
                  onChange={(e) => {
                    setDurationId(e.target.value);
                    setCustomDate("");
                  }}
                >
                  {DURATIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={LABEL}>
                …ou date précise
                <input
                  type="datetime-local"
                  className={FIELD}
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
              </label>
            </div>
            <p className="text-xs text-[#8A6B4D]">
              {hasExpiry
                ? "La sanction sera levée automatiquement à l'échéance."
                : "Sanction permanente jusqu'à levée manuelle."}
            </p>
            {error ? <ErrorBanner message={error} /> : null}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <GhostButton onClick={onClose} disabled={saving}>
              Annuler
            </GhostButton>
            <PrimaryButton onClick={save} disabled={saving}>
              {saving ? "Application…" : "Appliquer"}
            </PrimaryButton>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Edit modal ──────────────────────────────────────────────────────────────────

function EditModal({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  onClose: () => void;
  onSaved: (u: AdminUser) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [city, setCity] = useState(user.city ?? "");
  const [countryCode, setCountryCode] = useState(user.countryCode ?? "");
  const [role, setRole] = useState<UserRole>(user.role);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateAdminUser(user.id, {
        displayName: displayName.trim() || null,
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        city: city.trim() || null,
        countryCode: countryCode.trim() ? countryCode.trim().toUpperCase() : null,
        role,
      });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5">
        <div onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-[#1A0F0A] mb-4">Modifier {fullName(user)}</h3>
          <div className="space-y-3">
            <label className={LABEL}>
              Nom affiché
              <input className={FIELD} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL}>
                Prénom
                <input className={FIELD} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </label>
              <label className={LABEL}>
                Nom
                <input className={FIELD} value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL}>
                Ville
                <input className={FIELD} value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
              <label className={LABEL}>
                Pays (ISO-2)
                <input className={FIELD} maxLength={2} value={countryCode} onChange={(e) => setCountryCode(e.target.value)} />
              </label>
            </div>
            <label className={LABEL}>
              Rôle
              <select className={FIELD} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                <option value="user">Utilisateur</option>
                <option value="moderator">Modérateur</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {error ? <ErrorBanner message={error} /> : null}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <GhostButton onClick={onClose} disabled={saving}>
              Annuler
            </GhostButton>
            <PrimaryButton onClick={save} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </PrimaryButton>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Detail drawer ────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[#EDE3D6] bg-white px-3 py-2">
      <p className="text-lg font-bold text-[#1A0F0A]">{value}</p>
      <p className="text-xs text-[#8A6B4D]">{label}</p>
    </div>
  );
}

function DetailDrawer({
  userId,
  isAdmin,
  onClose,
}: {
  userId: string;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "audit">("overview");
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AdminUserAuditRow[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchUserDetail(userId, controller.signal)
      .then(setDetail)
      .catch((e) => {
        if (controller.signal.aborted) return;
        setError(e instanceof AdminApiError ? e.message : "Chargement impossible.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId]);

  useEffect(() => {
    if (tab !== "audit" || audit !== null || !isAdmin) return;
    const controller = new AbortController();
    setAuditLoading(true);
    fetchUserAudit(userId, 50, controller.signal)
      .then(setAudit)
      .catch(() => setAudit([]))
      .finally(() => {
        if (!controller.signal.aborted) setAuditLoading(false);
      });
    return () => controller.abort();
  }, [tab, audit, isAdmin, userId]);

  async function runAction(key: string, fn: () => Promise<void>) {
    setActionBusy(key);
    setActionMsg(null);
    try {
      await fn();
    } catch (e) {
      setActionMsg(e instanceof AdminApiError ? e.message : "Action impossible.");
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-lg overflow-y-auto bg-[#FDFBF7] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#EDE3D6] bg-[#FDFBF7] px-5 py-4">
          <h3 className="text-lg font-bold text-[#1A0F0A]">Fiche utilisateur</h3>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5A4634] hover:bg-[#F1E9DD]"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1.5 px-5 pt-4">
          <button
            type="button"
            onClick={() => setTab("overview")}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              tab === "overview" ? "bg-[#1A0F0A] text-white" : "text-[#5A4634] hover:bg-[#F1E9DD]"
            }`}
          >
            Aperçu
          </button>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setTab("audit")}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                tab === "audit" ? "bg-[#1A0F0A] text-white" : "text-[#5A4634] hover:bg-[#F1E9DD]"
              }`}
            >
              Audit
            </button>
          ) : null}
        </div>

        <div className="p-5">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          ) : error ? (
            <ErrorBanner message={error} />
          ) : !detail ? null : tab === "overview" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar src={detail.avatarUrl} name={fullName(detail)} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-[#1A0F0A] truncate">{fullName(detail)}</span>
                    {detail.identityStatus === "approved" ? (
                      <BadgeCheck className="w-4 h-4 text-emerald-600 shrink-0" aria-label="Identité vérifiée" />
                    ) : null}
                    {detail.isAmbassador ? (
                      <Award className="w-4 h-4 text-amber-500 shrink-0" aria-label="Ambassadeur" />
                    ) : null}
                    <StatusChip tone={ROLE_TONE[detail.role]}>{detail.role}</StatusChip>
                    <StatusChip tone={STATUS_TONE[detail.status]}>{STATUS_LABEL[detail.status]}</StatusChip>
                  </div>
                  <p className="text-xs text-[#8A6B4D] truncate">{detail.email}</p>
                </div>
              </div>

              {detail.status !== "active" && detail.statusReason ? (
                <div className="rounded-lg border border-[#F5C2C2] bg-[#FCE8E8] px-3 py-2">
                  <p className="text-xs font-semibold text-[#B91C1C]">Motif de la sanction</p>
                  <p className="text-sm text-[#7A1414]">{detail.statusReason}</p>
                  {detail.statusExpiresAt ? (
                    <p className="text-xs text-[#B91C1C] mt-0.5">
                      Levée automatique le {formatDate(detail.statusExpiresAt)}
                    </p>
                  ) : (
                    <p className="text-xs text-[#B91C1C] mt-0.5">Permanente (levée manuelle)</p>
                  )}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Stat label="Posts" value={detail.counts.posts} />
                <Stat label="Commentaires" value={detail.counts.comments} />
                <Stat label="Signalé" value={detail.counts.reportsReceived} />
                <Stat label="A signalé" value={detail.counts.reportsMade} />
                <Stat label="Invit. émises" value={detail.invitations.sent} />
                <Stat label="Filleuls" value={detail.invitations.accepted} />
              </div>

              <div className="rounded-lg border border-[#EDE3D6] bg-white p-3 text-sm">
                <dl className="grid grid-cols-2 gap-y-1.5">
                  <dt className="text-[#8A6B4D]">Email vérifié</dt>
                  <dd className="text-[#1A0F0A]">{detail.emailVerified ? "Oui" : "Non"}</dd>
                  <dt className="text-[#8A6B4D]">Identité</dt>
                  <dd className="text-[#1A0F0A]">{detail.identityStatus}</dd>
                  <dt className="text-[#8A6B4D]">2FA (MFA)</dt>
                  <dd className="text-[#1A0F0A]">{detail.mfaEnabled ? "Activée" : "Désactivée"}</dd>
                  <dt className="text-[#8A6B4D]">Localisation</dt>
                  <dd className="text-[#1A0F0A]">
                    {[detail.city, detail.countryCode].filter(Boolean).join(", ") || "—"}
                  </dd>
                  <dt className="text-[#8A6B4D]">Parrain</dt>
                  <dd className="text-[#1A0F0A]">{detail.invitedBy?.displayName ?? "—"}</dd>
                  <dt className="text-[#8A6B4D]">Inscrit</dt>
                  <dd className="text-[#1A0F0A]">{formatDate(detail.createdAt)}</dd>
                  <dt className="text-[#8A6B4D]">Dernière connexion</dt>
                  <dd className="text-[#1A0F0A]">
                    {detail.lastLoginAt ? formatDate(detail.lastLoginAt) : "—"}
                  </dd>
                </dl>
              </div>

              <div className="rounded-lg border border-[#EDE3D6] bg-white p-3">
                <p className="mb-2 text-xs font-semibold text-[#8A6B4D]">
                  Sessions actives ({detail.sessions.length})
                </p>
                {detail.sessions.length === 0 ? (
                  <p className="text-sm text-[#8A6B4D]">Aucune session active.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-[#1A0F0A]">
                    {detail.sessions.map((s) => (
                      <li key={s.id} className="flex justify-between gap-2">
                        <span className="truncate">{s.deviceName ?? "Appareil inconnu"}</span>
                        <span className="text-xs text-[#8A6B4D] shrink-0">
                          {s.usedAt ? formatDate(s.usedAt) : formatDate(s.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {isAdmin ? (
                <div className="rounded-lg border border-[#EDE3D6] bg-white p-3">
                  <p className="mb-2 text-xs font-semibold text-[#8A6B4D]">Actions compte</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={actionBusy !== null}
                      onClick={() =>
                        runAction("logout", async () => {
                          const r = await forceLogoutUser(userId);
                          setActionMsg(`${r.revoked} session(s) révoquée(s).`);
                          setDetail((d) => (d ? { ...d, sessions: [] } : d));
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-[#E8DFD3] px-2.5 py-1.5 text-xs font-semibold text-[#B45309] hover:bg-[#FEF3E2] disabled:opacity-50"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      {actionBusy === "logout" ? "…" : "Forcer la déconnexion"}
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy !== null || !detail.mfaEnabled}
                      onClick={() =>
                        runAction("mfa", async () => {
                          await resetUserMfa(userId);
                          setActionMsg("2FA réinitialisée.");
                          setDetail((d) => (d ? { ...d, mfaEnabled: false } : d));
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-[#E8DFD3] px-2.5 py-1.5 text-xs font-semibold text-[#5A4634] hover:bg-[#FDFBF7] disabled:opacity-50"
                      title={detail.mfaEnabled ? "Réinitialiser la 2FA" : "2FA déjà désactivée"}
                    >
                      <ShieldOff className="w-3.5 h-3.5" />
                      {actionBusy === "mfa" ? "…" : "Réinitialiser 2FA"}
                    </button>
                  </div>
                  {actionMsg ? <p className="mt-2 text-xs text-[#15803D]">{actionMsg}</p> : null}
                  <p className="mt-2 flex items-start gap-1 text-[11px] text-[#8A6B4D]">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    Le renvoi de l&apos;email de vérification n&apos;est pas encore branché (brique auth).
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            // Audit tab
            <div>
              {auditLoading ? (
                <Skeleton className="h-24 w-full rounded-xl" />
              ) : !audit || audit.length === 0 ? (
                <EmptyState>
                  <p className="text-sm">Aucune action enregistrée sur ce compte.</p>
                </EmptyState>
              ) : (
                <ul className="space-y-2">
                  {audit.map((row) => (
                    <li key={row.id} className="rounded-lg border border-[#EDE3D6] bg-white px-3 py-2 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="font-semibold text-[#1A0F0A]">{row.action}</span>
                        <span className="text-xs text-[#8A6B4D] shrink-0">{formatDate(row.createdAt)}</span>
                      </div>
                      {row.meta && Object.keys(row.meta).length > 0 ? (
                        <p className="mt-0.5 break-words text-xs text-[#8A6B4D]">{JSON.stringify(row.meta)}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────────

function UserRow({
  user,
  isAdmin,
  onChanged,
  onDeleted,
  onEdit,
  onSanction,
  onDetail,
}: {
  user: AdminUser;
  isAdmin: boolean;
  onChanged: (u: AdminUser) => void;
  onDeleted: (id: string) => void;
  onEdit: (u: AdminUser) => void;
  onSanction: (u: AdminUser, status: Exclude<UserStatus, "active">) => void;
  onDetail: (u: AdminUser) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function reactivate() {
    setBusy(true);
    setError(null);
    try {
      await setUserStatus(user.id, "active");
      onChanged({ ...user, status: "active", statusReason: null, statusExpiresAt: null });
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      await deleteAdminUser(user.id);
      onDeleted(user.id);
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Suppression impossible.");
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={() => onDetail(user)} title="Voir la fiche">
          <Avatar src={user.avatarUrl} name={fullName(user)} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => onDetail(user)}
              className="font-semibold text-[#1A0F0A] truncate hover:underline"
            >
              {fullName(user)}
            </button>
            {user.identityStatus === "approved" ? (
              <BadgeCheck className="w-4 h-4 text-emerald-600 shrink-0" aria-label="Identité vérifiée" />
            ) : null}
            {user.isAmbassador ? (
              <Award className="w-4 h-4 text-amber-500 shrink-0" aria-label="Ambassadeur" />
            ) : null}
            <StatusChip tone={ROLE_TONE[user.role]}>{user.role}</StatusChip>
            <StatusChip tone={STATUS_TONE[user.status]}>{STATUS_LABEL[user.status]}</StatusChip>
          </div>
          <p className="text-xs text-[#8A6B4D] truncate">
            {user.email}
            {user.city || user.countryCode ? ` · ${[user.city, user.countryCode].filter(Boolean).join(", ")}` : ""}
            {` · inscrit ${formatDate(user.createdAt)}`}
          </p>
          {user.status !== "active" && user.statusReason ? (
            <p className="text-xs text-[#B91C1C] truncate mt-0.5" title={user.statusReason}>
              Motif : {user.statusReason}
              {user.statusExpiresAt ? ` (jusqu'au ${formatDate(user.statusExpiresAt)})` : ""}
            </p>
          ) : null}
          {error ? <p className="text-xs text-red-600 mt-1">{error}</p> : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {user.status !== "active" ? (
            <button
              type="button"
              onClick={reactivate}
              disabled={busy}
              title="Réactiver"
              className="inline-flex items-center gap-1 text-xs font-semibold border border-[#E8DFD3] text-[#15803D] hover:bg-[#E7F4EC] px-2.5 py-1.5 rounded-lg disabled:opacity-50"
            >
              <UserCheck className="w-3.5 h-3.5" /> Activer
            </button>
          ) : null}
          {user.status !== "suspended" ? (
            <button
              type="button"
              onClick={() => onSanction(user, "suspended")}
              disabled={busy}
              title="Suspendre"
              className="inline-flex items-center gap-1 text-xs font-semibold border border-[#E8DFD3] text-[#B45309] hover:bg-[#FEF3E2] px-2.5 py-1.5 rounded-lg disabled:opacity-50"
            >
              <UserX className="w-3.5 h-3.5" /> Suspendre
            </button>
          ) : null}
          {user.status !== "banned" ? (
            <button
              type="button"
              onClick={() => onSanction(user, "banned")}
              disabled={busy}
              title="Bannir"
              className="inline-flex items-center gap-1 text-xs font-semibold border border-[#F5C2C2] text-[#B91C1C] hover:bg-[#FCE8E8] px-2.5 py-1.5 rounded-lg disabled:opacity-50"
            >
              <Ban className="w-3.5 h-3.5" /> Bannir
            </button>
          ) : null}
          {isAdmin ? (
            <>
              <button
                type="button"
                onClick={() => onEdit(user)}
                disabled={busy}
                title="Modifier"
                className="inline-flex items-center justify-center w-8 h-8 border border-[#E8DFD3] text-[#5A4634] hover:bg-[#FDFBF7] rounded-lg disabled:opacity-50"
              >
                <Pencil className="w-4 h-4" />
              </button>
              {confirmDel ? (
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={busy}
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-[#B91C1C] text-white px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                >
                  {busy ? "…" : "Confirmer"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDel(true)}
                  disabled={busy}
                  title="Supprimer"
                  className="inline-flex items-center justify-center w-8 h-8 border border-[#F5C2C2] text-[#B91C1C] hover:bg-[#FCE8E8] rounded-lg disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────────

const PERIODS: Array<{ id: string; label: string; days: number | null }> = [
  { id: "all", label: "Toute période", days: null },
  { id: "24h", label: "24 h", days: 1 },
  { id: "7d", label: "7 jours", days: 7 },
  { id: "30d", label: "30 jours", days: 30 },
];

function periodToIso(id: string): string | undefined {
  const p = PERIODS.find((x) => x.id === id);
  if (!p || p.days === null) return undefined;
  return new Date(Date.now() - p.days * 24 * 3_600_000).toISOString();
}

export default function UsersSection({ role }: { role: AdminRole | null }) {
  const isAdmin = role === "admin";
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [verifiedFilter, setVerifiedFilter] = useState<"all" | "true" | "false">("all");
  const [countryFilter, setCountryFilter] = useState("");
  const [identityFilter, setIdentityFilter] = useState<IdentityDistStatus | "all">("all");
  const [ambassadorFilter, setAmbassadorFilter] = useState<"all" | "true" | "false">("all");
  const [periodFilter, setPeriodFilter] = useState("all");

  const [items, setItems] = useState<AdminUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [sanctioning, setSanctioning] = useState<{ user: AdminUser; status: Exclude<UserStatus, "active"> } | null>(
    null,
  );
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildFilters = useCallback(
    (): AdminUserFilters => ({
      q: query.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      role: roleFilter === "all" ? undefined : roleFilter,
      emailVerified: verifiedFilter === "all" ? undefined : verifiedFilter === "true",
      countryCode: countryFilter.trim() ? countryFilter.trim().toUpperCase() : undefined,
      identityStatus: identityFilter === "all" ? undefined : identityFilter,
      ambassador: ambassadorFilter === "all" ? undefined : ambassadorFilter === "true",
      createdAfter: periodToIso(periodFilter),
    }),
    [query, statusFilter, roleFilter, verifiedFilter, countryFilter, identityFilter, ambassadorFilter, periodFilter],
  );

  const load = useCallback((filters: AdminUserFilters, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    listAdminUsers(filters, signal)
      .then((res) => {
        setItems(res.items);
        setCursor(res.nextCursor);
      })
      .catch((e) => {
        if (signal?.aborted) return;
        setError(e instanceof AdminApiError ? e.message : "Chargement impossible.");
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const controller = new AbortController();
    const filters = buildFilters();
    debounceRef.current = setTimeout(() => load(filters, controller.signal), 250);
    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [buildFilters, load]);

  function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    listAdminUsers({ ...buildFilters(), cursor })
      .then((res) => {
        setItems((prev) => [...prev, ...res.items]);
        setCursor(res.nextCursor);
      })
      .catch((e) => setError(e instanceof AdminApiError ? e.message : "Chargement impossible."))
      .finally(() => setLoadingMore(false));
  }

  const selectCls = FIELD.replace("w-full ", "");

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-[#1A0F0A]">Utilisateurs</h2>
        <p className="text-sm text-[#8A6B4D] mt-0.5">
          Voir les inscrits, sanctionner (motif + durée), consulter la fiche détaillée, modifier ou supprimer un compte.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A6B4D]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher (nom ou email)…"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] placeholder-[#B59B82] focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-2 rounded-lg text-sm font-semibold border ${
                statusFilter === f.id
                  ? "bg-[#1A0F0A] text-white border-[#1A0F0A]"
                  : "bg-white text-[#5A4634] border-[#E8DFD3] hover:bg-[#FDFBF7]"
              }`}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            title="Filtres avancés"
            className={`inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-semibold border ${
              showFilters
                ? "bg-[#1A0F0A] text-white border-[#1A0F0A]"
                : "bg-white text-[#5A4634] border-[#E8DFD3] hover:bg-[#FDFBF7]"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showFilters ? (
        <Card className="p-4 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label className={LABEL}>
              Rôle
              <select
                className={selectCls}
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as UserRole | "all")}
              >
                <option value="all">Tous</option>
                <option value="user">Utilisateur</option>
                <option value="moderator">Modérateur</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className={LABEL}>
              Email vérifié
              <select
                className={selectCls}
                value={verifiedFilter}
                onChange={(e) => setVerifiedFilter(e.target.value as "all" | "true" | "false")}
              >
                <option value="all">Tous</option>
                <option value="true">Vérifié</option>
                <option value="false">Non vérifié</option>
              </select>
            </label>
            <label className={LABEL}>
              Identité
              <select
                className={selectCls}
                value={identityFilter}
                onChange={(e) => setIdentityFilter(e.target.value as IdentityDistStatus | "all")}
              >
                <option value="all">Toutes</option>
                <option value="not_submitted">Non soumise</option>
                <option value="pending">En attente</option>
                <option value="approved">Approuvée</option>
                <option value="rejected">Rejetée</option>
              </select>
            </label>
            <label className={LABEL}>
              Ambassadeur
              <select
                className={selectCls}
                value={ambassadorFilter}
                onChange={(e) => setAmbassadorFilter(e.target.value as "all" | "true" | "false")}
              >
                <option value="all">Tous</option>
                <option value="true">Ambassadeurs</option>
                <option value="false">Non-ambassadeurs</option>
              </select>
            </label>
            <label className={LABEL}>
              Pays (ISO-2)
              <input
                className={selectCls}
                maxLength={2}
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
                placeholder="NE"
              />
            </label>
            <label className={LABEL}>
              Période d&apos;inscription
              <select className={selectCls} value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
                {PERIODS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState>
          <p className="font-semibold text-[#1A0F0A]">Aucun utilisateur</p>
          <p className="text-sm mt-1">Aucun compte ne correspond à ce filtre.</p>
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isAdmin={isAdmin}
              onChanged={(nu) => setItems((prev) => prev.map((x) => (x.id === nu.id ? nu : x)))}
              onDeleted={(id) => setItems((prev) => prev.filter((x) => x.id !== id))}
              onEdit={setEditing}
              onSanction={(user, status) => setSanctioning({ user, status })}
              onDetail={(user) => setDetailUserId(user.id)}
            />
          ))}
          {cursor ? (
            <div className="flex justify-center pt-2">
              <GhostButton onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Chargement…" : "Charger plus"}
              </GhostButton>
            </div>
          ) : null}
        </div>
      )}

      {editing ? (
        <EditModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={(u) => {
            setItems((prev) => prev.map((x) => (x.id === u.id ? u : x)));
            setEditing(null);
          }}
        />
      ) : null}

      {sanctioning ? (
        <SanctionModal
          user={sanctioning.user}
          initialStatus={sanctioning.status}
          onClose={() => setSanctioning(null)}
          onSaved={(patch) => {
            setItems((prev) => prev.map((x) => (x.id === sanctioning.user.id ? { ...x, ...patch } : x)));
            setSanctioning(null);
          }}
        />
      ) : null}

      {detailUserId ? (
        <DetailDrawer userId={detailUserId} isAdmin={isAdmin} onClose={() => setDetailUserId(null)} />
      ) : null}
    </section>
  );
}
