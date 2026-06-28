"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Award,
  BadgeCheck,
  Ban,
  Pencil,
  Search,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react";
import {
  listAdminUsers,
  setUserStatus,
  updateAdminUser,
  deleteAdminUser,
  AdminApiError,
  type AdminUser,
  type AdminRole,
  type UserStatus,
  type UserRole,
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

function fullName(u: AdminUser): string {
  const n = u.displayName ?? [u.firstName, u.lastName].filter(Boolean).join(" ");
  return n || u.email;
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

  const field = "w-full px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] focus:outline-none focus:ring-2 focus:ring-amber-400/50";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-5" >
        <div onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg font-bold text-[#1A0F0A] mb-4">Modifier {fullName(user)}</h3>
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-[#8A6B4D]">
              Nom affiché
              <input className={field} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-[#8A6B4D]">
                Prénom
                <input className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </label>
              <label className="block text-xs font-semibold text-[#8A6B4D]">
                Nom
                <input className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-[#8A6B4D]">
                Ville
                <input className={field} value={city} onChange={(e) => setCity(e.target.value)} />
              </label>
              <label className="block text-xs font-semibold text-[#8A6B4D]">
                Pays (ISO-2)
                <input className={field} maxLength={2} value={countryCode} onChange={(e) => setCountryCode(e.target.value)} />
              </label>
            </div>
            <label className="block text-xs font-semibold text-[#8A6B4D]">
              Rôle
              <select className={field} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                <option value="user">Utilisateur</option>
                <option value="moderator">Modérateur</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {error ? <ErrorBanner message={error} /> : null}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <GhostButton onClick={onClose} disabled={saving}>Annuler</GhostButton>
            <PrimaryButton onClick={save} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </PrimaryButton>
          </div>
        </div>
      </Card>
    </div>
  );
}

function UserRow({
  user,
  isAdmin,
  onChanged,
  onDeleted,
  onEdit,
}: {
  user: AdminUser;
  isAdmin: boolean;
  onChanged: (u: AdminUser) => void;
  onDeleted: (id: string) => void;
  onEdit: (u: AdminUser) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function changeStatus(status: UserStatus) {
    setBusy(true);
    setError(null);
    try {
      await setUserStatus(user.id, status);
      onChanged({ ...user, status });
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
        <Avatar src={user.avatarUrl} name={fullName(user)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-[#1A0F0A] truncate">{fullName(user)}</span>
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
          {error ? <p className="text-xs text-red-600 mt-1">{error}</p> : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {user.status !== "active" ? (
            <button
              type="button"
              onClick={() => changeStatus("active")}
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
              onClick={() => changeStatus("suspended")}
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
              onClick={() => changeStatus("banned")}
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

export default function UsersSection({ role }: { role: AdminRole | null }) {
  const isAdmin = role === "admin";
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");
  const [items, setItems] = useState<AdminUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    (q: string, status: UserStatus | "all", signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      listAdminUsers(
        { q: q.trim() || undefined, status: status === "all" ? undefined : status },
        signal,
      )
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
    },
    [],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const controller = new AbortController();
    debounceRef.current = setTimeout(() => load(query, statusFilter, controller.signal), 250);
    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, statusFilter, load]);

  function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    listAdminUsers({
      q: query.trim() || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
      cursor,
    })
      .then((res) => {
        setItems((prev) => [...prev, ...res.items]);
        setCursor(res.nextCursor);
      })
      .catch((e) => setError(e instanceof AdminApiError ? e.message : "Chargement impossible."))
      .finally(() => setLoadingMore(false));
  }

  return (
    <section>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-[#1A0F0A]">Utilisateurs</h2>
        <p className="text-sm text-[#8A6B4D] mt-0.5">
          Voir les inscrits, bloquer (suspendre / bannir), modifier ou supprimer un compte.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A6B4D]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher (nom ou email)…"
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] placeholder-[#B59B82] focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          />
        </div>
        <div className="flex gap-1.5">
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
        </div>
      </div>

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
    </section>
  );
}
