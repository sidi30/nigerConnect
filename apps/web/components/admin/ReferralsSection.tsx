"use client";

// "Réseau de parrainage" — admin section listing who invited whom.
//
// Data source : GET /admin/referrals?cursor=&limit= (paginated, nextCursor).
// Also exposes a control to grant / revoke canBulkInvite for any user.

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Link2, Network, UserCheck, Users } from "lucide-react";
import {
  AdminApiError,
  listReferrals,
  setBulkInviteRight,
  type ReferralNode,
} from "@/lib/adminApi";
import {
  Avatar,
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  formatDate,
  GhostButton,
  PrimaryButton,
  Skeleton,
  StatusChip,
} from "./ui";

// ---------------------------------------------------------------------------
// Kind badge
// ---------------------------------------------------------------------------

function KindBadge({ kind }: { kind: "single_use" | "reusable" | null }) {
  if (!kind) {
    return (
      <StatusChip tone="neutral">—</StatusChip>
    );
  }
  return kind === "reusable" ? (
    <StatusChip tone="blue" icon={Link2}>
      lien
    </StatusChip>
  ) : (
    <StatusChip tone="neutral">email / code</StatusChip>
  );
}

// ---------------------------------------------------------------------------
// Table row
// ---------------------------------------------------------------------------

function ReferralRow({ node }: { node: ReferralNode }) {
  const name = node.displayName ?? "Utilisateur";
  const sponsorName = node.invitedBy?.displayName ?? null;

  return (
    <tr className="border-b border-[#F1E9DD] last:border-0 hover:bg-[#FDFBF7] transition-colors">
      {/* Membre */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar src={node.avatarUrl} name={name} size={32} />
          <span className="text-sm font-semibold text-[#1A0F0A] truncate">
            {name}
          </span>
        </div>
      </td>

      {/* Parrain */}
      <td className="px-4 py-3 hidden sm:table-cell">
        {sponsorName ? (
          <span className="text-sm text-[#5A4634] truncate block max-w-[180px]">
            {sponsorName}
          </span>
        ) : (
          <span className="text-xs text-[#8A6B4D]">aucun</span>
        )}
      </td>

      {/* Type */}
      <td className="px-4 py-3 hidden md:table-cell">
        <KindBadge kind={node.via?.kind ?? null} />
      </td>

      {/* Filleuls */}
      <td className="px-4 py-3 text-right tabular-nums">
        <span className="text-sm font-semibold text-[#1A0F0A]">
          {node.inviteesCount}
        </span>
      </td>

      {/* Date */}
      <td className="px-4 py-3 hidden lg:table-cell text-xs text-[#8A6B4D] whitespace-nowrap">
        {formatDate(node.createdAt)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i} className="border-b border-[#F1E9DD]">
          <td className="px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Skeleton className="w-8 h-8 rounded-full" />
              <Skeleton className="h-4 w-28" />
            </div>
          </td>
          <td className="px-4 py-3 hidden sm:table-cell">
            <Skeleton className="h-4 w-24" />
          </td>
          <td className="px-4 py-3 hidden md:table-cell">
            <Skeleton className="h-5 w-20 rounded-full" />
          </td>
          <td className="px-4 py-3 text-right">
            <Skeleton className="h-4 w-6 ml-auto" />
          </td>
          <td className="px-4 py-3 hidden lg:table-cell">
            <Skeleton className="h-3 w-28" />
          </td>
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bulk-invite grant/revoke control
// ---------------------------------------------------------------------------

function BulkInviteControl() {
  const [userId, setUserId] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function submit() {
    const trimmed = userId.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await setBulkInviteRight(trimmed, allowed);
      const action = res.canBulkInvite ? "accordé" : "retiré";
      setSuccess(`Droit lien de masse ${action} pour l'utilisateur ${res.id}.`);
      setUserId("");
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setSuccess(null), 4000);
    } catch (e) {
      setError(
        e instanceof AdminApiError ? e.message : "Erreur lors de la mise à jour.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader
        icon={UserCheck}
        title="Droit lien de masse (canBulkInvite)"
        subtitle="Accordez ou retirez à un membre le droit de créer des liens réutilisables"
      />

      <div className="flex flex-wrap gap-3 items-end">
        {/* User ID field */}
        <div className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
          <label
            htmlFor="bulk-invite-user-id"
            className="text-xs font-semibold text-[#5A4634] uppercase tracking-wide"
          >
            ID utilisateur
          </label>
          <input
            id="bulk-invite-user-id"
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="cuid de l'utilisateur…"
            disabled={loading}
            className="rounded-lg border border-[#E8DFD3] bg-[#FDFBF7] px-3 py-2 text-sm text-[#1A0F0A] placeholder:text-[#A89882] focus:outline-none focus:ring-2 focus:ring-[#E05206] disabled:opacity-50"
          />
        </div>

        {/* Toggle: accorder / retirer */}
        <div
          role="group"
          aria-label="Action sur le droit"
          className="inline-flex rounded-xl border border-[#E8DFD3] bg-[#FDFBF7] p-1 gap-1 shrink-0"
        >
          <button
            type="button"
            disabled={loading}
            aria-pressed={allowed}
            onClick={() => setAllowed(true)}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E05206] disabled:opacity-50 ${
              allowed
                ? "bg-[#E7F4EC] text-[#15803D] shadow-sm"
                : "text-[#5A4634] hover:text-[#1A0F0A] hover:bg-white"
            }`}
          >
            Accorder
          </button>
          <button
            type="button"
            disabled={loading}
            aria-pressed={!allowed}
            onClick={() => setAllowed(false)}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E05206] disabled:opacity-50 ${
              !allowed
                ? "bg-[#FCE8E8] text-[#B91C1C] shadow-sm"
                : "text-[#5A4634] hover:text-[#1A0F0A] hover:bg-white"
            }`}
          >
            Retirer
          </button>
        </div>

        <PrimaryButton onClick={() => void submit()} disabled={loading || !userId.trim()}>
          {loading ? "Enregistrement…" : "Appliquer"}
        </PrimaryButton>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      ) : null}

      {success ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-[#15803D] font-semibold">
          <CheckCircle2 size={15} strokeWidth={2.5} aria-hidden="true" />
          {success}
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Referrals table (paginated)
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

function ReferralsTable() {
  const [items, setItems] = useState<ReferralNode[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listReferrals(undefined, PAGE_SIZE, signal);
      setItems(res.items);
      setNextCursor(res.nextCursor);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(
        e instanceof AdminApiError ? e.message : "Erreur de chargement.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await listReferrals(nextCursor, PAGE_SIZE);
      setItems((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
    } catch (e) {
      setError(
        e instanceof AdminApiError ? e.message : "Erreur lors du chargement.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader
        icon={Network}
        title="Réseau de parrainage"
        subtitle="Membres récents — parrain, type d'invitation et filleuls directs"
        right={
          <GhostButton onClick={() => void load()} disabled={loading}>
            Actualiser
          </GhostButton>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorBanner
            message={error}
            onRetry={items.length === 0 ? () => void load() : undefined}
          />
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left" aria-label="Chargement du réseau de parrainage">
            <thead>
              <TableHead />
            </thead>
            <tbody>
              <SkeletonRows />
            </tbody>
          </table>
        </div>
      ) : !loading && items.length === 0 ? (
        <EmptyState>
          <div className="flex flex-col items-center gap-2 text-[#8A6B4D]">
            <Users size={28} strokeWidth={1.75} aria-hidden="true" />
            <span>Aucun membre avec parrain pour l&apos;instant</span>
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table
              className="w-full text-left"
              aria-label="Réseau de parrainage"
            >
              <thead>
                <TableHead />
              </thead>
              <tbody>
                {items.map((node) => (
                  <ReferralRow key={node.id} node={node} />
                ))}
                {loadingMore ? <SkeletonRows /> : null}
              </tbody>
            </table>
          </div>

          {nextCursor ? (
            <div className="mt-4 flex justify-center">
              <GhostButton onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Chargement…" : "Charger plus"}
              </GhostButton>
            </div>
          ) : (
            items.length > 0 && (
              <p className="mt-3 text-center text-xs text-[#8A6B4D]">
                Tous les membres affichés ({items.length})
              </p>
            )
          )}
        </>
      )}
    </Card>
  );
}

function TableHead() {
  return (
    <tr className="border-b border-[#E8DFD3]">
      <th className="px-4 pb-2 text-xs font-semibold text-[#8A6B4D] uppercase tracking-wide">
        Membre
      </th>
      <th className="px-4 pb-2 text-xs font-semibold text-[#8A6B4D] uppercase tracking-wide hidden sm:table-cell">
        Parrain
      </th>
      <th className="px-4 pb-2 text-xs font-semibold text-[#8A6B4D] uppercase tracking-wide hidden md:table-cell">
        Type
      </th>
      <th className="px-4 pb-2 text-xs font-semibold text-[#8A6B4D] uppercase tracking-wide text-right">
        Filleuls
      </th>
      <th className="px-4 pb-2 text-xs font-semibold text-[#8A6B4D] uppercase tracking-wide hidden lg:table-cell">
        Date
      </th>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function ReferralsSection() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <span className="grid place-items-center w-8 h-8 rounded-lg bg-[#FDF0E6] text-[#E05206] shrink-0">
          <Network size={18} strokeWidth={2} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-[#1A0F0A] leading-tight">
            Réseau de parrainage
          </h2>
          <p className="text-xs text-[#8A6B4D]">
            Arbre des parrainages, liens réutilisables et droits de masse
          </p>
        </div>
      </div>

      <BulkInviteControl />
      <ReferralsTable />
    </div>
  );
}
