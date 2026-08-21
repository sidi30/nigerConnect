"use client";

// Certification des associations (A5) — le badge « Association vérifiée »
// existait dans le schéma (`Association.isVerified`) et deux endpoints
// (`POST /admin/associations/:id/verify|unverify`) l'attribuaient/le
// retiraient, mais personne ne pouvait les appeler sans fabriquer une requête
// HTTP à la main. Cette section comble ce trou.
//
// Deux limites côté API, assumées ici plutôt que contournées en touchant
// apps/api :
//  1. `GET /associations` (utilisé pour la liste — il n'existe pas de listing
//     dédié admin) n'a pas de paramètre de recherche texte, seulement
//     `category`/`country`. La recherche ci-dessous filtre donc le pool
//     d'associations déjà chargées et va chercher des pages supplémentaires
//     tant qu'aucune correspondance locale n'est trouvée (voir l'effet
//     `autoSearchMore`), jusqu'à un plafond de pages.
//  2. Le « qui a certifié » n'est nulle part exposé sous une forme
//     présentable : `verifiedById` est absent de la projection publique
//     (`ASSOCIATION_PUBLIC_SELECT`) et, même sur la réponse brute de
//     verify/unverify qui le contient, ce n'est qu'un UUID — aucun endpoint
//     ne le résout en nom d'admin. On affiche donc seulement `verifiedAt`
//     (public, « Vérifiée le … »), jamais un identifiant brut qui n'aiderait
//     personne.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Building2,
  Search,
  ShieldOff,
  Users as UsersIcon,
} from "lucide-react";
import {
  listAssociations,
  verifyAssociation,
  unverifyAssociation,
  AdminApiError,
  type AdminAssociation,
  type AssociationCategory,
} from "@/lib/adminApi";
import { countryFlag, countryName } from "./map/countryNames";
import {
  Avatar,
  Card,
  EmptyState,
  ErrorBanner,
  formatDate,
  GhostButton,
  Modal,
  PrimaryButton,
  Skeleton,
  StatusChip,
} from "./ui";

const CATEGORY_LABEL: Record<AssociationCategory, string> = {
  generaliste: "Généraliste",
  etudiants: "Étudiants",
  femmes: "Femmes",
  jeunesse: "Jeunesse",
  culture: "Culture",
  business: "Affaires",
  sport: "Sport",
  religieux: "Religieux",
};

const PAGE_LIMIT = 50;
// Recherche client-side : nombre de pages qu'on va chercher automatiquement,
// tant qu'aucune correspondance locale n'apparaît, avant d'abandonner (évite
// de rapatrier tout l'annuaire si la requête ne correspond à rien).
const AUTO_SEARCH_PAGE_CAP = 20;

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function matches(a: AdminAssociation, q: string): boolean {
  if (!q) return true;
  const hay = normalize(
    [a.name, a.city ?? "", a.slug, CATEGORY_LABEL[a.category], a.countryCode ?? ""].join(" "),
  );
  return hay.includes(q);
}

// ---------------------------------------------------------------------------
// Modale de confirmation — verify/unverify partagent la même forme (note
// interne optionnelle), seuls le libellé et l'action changent.
// ---------------------------------------------------------------------------

function CertifyModal({
  association,
  mode,
  onClose,
  onDone,
}: {
  association: AdminAssociation;
  mode: "verify" | "unverify";
  onClose: () => void;
  onDone: (id: string, patch: { isVerified: boolean; verifiedAt: string | null }) => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = `certify-modal-title-${association.id}`;

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      const res =
        mode === "verify"
          ? await verifyAssociation(association.id, note.trim() || undefined)
          : await unverifyAssociation(association.id, note.trim() || undefined);
      onDone(association.id, { isVerified: res.isVerified, verifiedAt: res.verifiedAt });
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Action impossible.");
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <Card className="w-full max-w-md p-5">
        <h3 id={titleId} className="text-lg font-bold text-[#1A0F0A] mb-1">
          {mode === "verify" ? "Certifier" : "Retirer la certification de"} {association.name}
        </h3>
        <p className="text-sm text-[#8A6B4D] mb-4">
          {mode === "verify"
            ? "Le badge « Association vérifiée » sera visible sur son profil et dans l'app mobile. Action tracée dans le journal d'audit."
            : "Le badge sera retiré immédiatement. Action tracée dans le journal d'audit."}
        </p>

        <label className="block text-xs font-semibold text-[#8A6B4D]">
          Note interne de modération (optionnelle)
          <textarea
            className="w-full mt-1 px-3 py-2 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              mode === "verify"
                ? "Ex : documents d'enregistrement vérifiés le …"
                : "Ex : documents non renouvelés, association injoignable…"
            }
          />
          <span className="block mt-1 text-[11px] text-[#8A6B4D]">
            Réservée à l&apos;équipe d&apos;administration — jamais visible par
            l&apos;association ni affichée publiquement.
          </span>
        </label>

        {error ? <ErrorBanner message={error} /> : null}

        <div className="flex justify-end gap-2 mt-5">
          <GhostButton onClick={onClose} disabled={saving}>
            Annuler
          </GhostButton>
          <PrimaryButton onClick={confirm} disabled={saving}>
            {saving
              ? "…"
              : mode === "verify"
                ? "Certifier l'association"
                : "Retirer la certification"}
          </PrimaryButton>
        </div>
      </Card>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Ligne de liste
// ---------------------------------------------------------------------------

function AssociationRow({
  association,
  onAction,
}: {
  association: AdminAssociation;
  onAction: (a: AdminAssociation, mode: "verify" | "unverify") => void;
}) {
  const flag = countryFlag(association.countryCode);
  const place = [association.city, association.countryCode ? countryName(association.countryCode) : null]
    .filter(Boolean)
    .join(", ");

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Avatar src={association.logoUrl} name={association.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-[#1A0F0A] truncate">{association.name}</span>
            {association.isVerified ? (
              <BadgeCheck
                className="w-4 h-4 text-emerald-600 shrink-0"
                aria-label="Association vérifiée"
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-[#8A6B4D]">
            <StatusChip tone="brand">{CATEGORY_LABEL[association.category]}</StatusChip>
            {place ? (
              <span className="inline-flex items-center gap-1">
                {flag ? <span aria-hidden="true">{flag}</span> : null}
                {place}
              </span>
            ) : (
              <span>Localisation non renseignée</span>
            )}
            <span className="inline-flex items-center gap-1">
              <UsersIcon className="w-3.5 h-3.5" aria-hidden="true" />
              {association.memberCount.toLocaleString("fr-FR")} membre
              {association.memberCount > 1 ? "s" : ""}
            </span>
          </div>

          <div className="mt-1.5">
            {association.isVerified ? (
              <StatusChip tone="green" icon={BadgeCheck}>
                Vérifiée{association.verifiedAt ? ` le ${formatDate(association.verifiedAt)}` : ""}
              </StatusChip>
            ) : (
              <StatusChip tone="neutral">Non certifiée</StatusChip>
            )}
          </div>
        </div>

        {association.isVerified ? (
          <GhostButton tone="danger" onClick={() => onAction(association, "unverify")}>
            <ShieldOff className="w-3.5 h-3.5" /> Retirer
          </GhostButton>
        ) : (
          <PrimaryButton onClick={() => onAction(association, "verify")}>
            <BadgeCheck className="w-3.5 h-3.5" /> Certifier
          </PrimaryButton>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export default function AssociationsSection() {
  const [items, setItems] = useState<AdminAssociation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [modal, setModal] = useState<{ association: AdminAssociation; mode: "verify" | "unverify" } | null>(
    null,
  );
  const pagesFetchedRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Chargement initial (et rechargement si jamais on ajoute un bouton
  // "rafraîchir" plus tard — gardé sous forme de fonction réutilisable).
  const loadFirstPage = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    pagesFetchedRef.current = 0;
    listAssociations({ limit: PAGE_LIMIT }, signal)
      .then((res) => {
        setItems(res.items);
        setNextCursor(res.nextCursor);
        pagesFetchedRef.current = 1;
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
    const controller = new AbortController();
    loadFirstPage(controller.signal);
    return () => controller.abort();
  }, [loadFirstPage]);

  const loadMore = useCallback(() => {
    if (!nextCursor || fetchingMore) return;
    setFetchingMore(true);
    listAssociations({ limit: PAGE_LIMIT, cursor: nextCursor })
      .then((res) => {
        setItems((prev) => [...prev, ...res.items]);
        setNextCursor(res.nextCursor);
        pagesFetchedRef.current += 1;
      })
      .catch((e) => {
        setError(e instanceof AdminApiError ? e.message : "Chargement impossible.");
      })
      .finally(() => setFetchingMore(false));
  }, [nextCursor, fetchingMore]);

  // Debounce la saisie, comme les autres sections (recherche membres).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const normalizedQuery = useMemo(() => normalize(debouncedQuery.trim()), [debouncedQuery]);
  const visible = useMemo(
    () => (normalizedQuery ? items.filter((a) => matches(a, normalizedQuery)) : items),
    [items, normalizedQuery],
  );

  // Pas de recherche texte côté API (voir le commentaire d'en-tête) : tant que
  // la requête ne correspond à rien de déjà chargé, on va chercher la page
  // suivante — jusqu'à épuisement du curseur ou du plafond de pages.
  useEffect(() => {
    if (!normalizedQuery) return;
    if (loading || fetchingMore) return;
    if (!nextCursor) return;
    if (visible.length > 0) return;
    if (pagesFetchedRef.current >= AUTO_SEARCH_PAGE_CAP) return;
    loadMore();
  }, [normalizedQuery, visible.length, nextCursor, loading, fetchingMore, loadMore]);

  function handleDone(id: string, patch: { isVerified: boolean; verifiedAt: string | null }) {
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    setModal(null);
  }

  const searching = normalizedQuery.length > 0;
  const exhaustedSearch =
    searching && !loading && !fetchingMore && visible.length === 0 && (!nextCursor || pagesFetchedRef.current >= AUTO_SEARCH_PAGE_CAP);

  return (
    <section>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold text-[#1A0F0A]">Associations — certification</h2>
          <p className="text-sm text-[#8A6B4D] mt-0.5">
            Attribue ou retire le badge « Association vérifiée ». Action tracée
            (journal d&apos;audit), révocable à tout moment.
          </p>
        </div>
        <StatusChip tone="brand" icon={Building2}>
          {items.length}
          {nextCursor ? "+" : ""} chargée{items.length > 1 ? "s" : ""}
        </StatusChip>
      </div>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A6B4D]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une association (nom, ville, catégorie)…"
          aria-label="Rechercher une association"
          className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-[#E5D5C3] bg-white text-[#1A0F0A] placeholder-[#B59B82] focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => loadFirstPage()} /> : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : visible.length > 0 ? (
        <div className="space-y-3">
          {visible.map((a) => (
            <AssociationRow
              key={a.id}
              association={a}
              onAction={(association, mode) => setModal({ association, mode })}
            />
          ))}
          {searching && fetchingMore ? (
            <p className="text-xs text-[#8A6B4D] text-center py-2">Recherche en cours…</p>
          ) : null}
          {!searching && nextCursor ? (
            <div className="flex justify-center pt-2">
              <GhostButton onClick={loadMore} disabled={fetchingMore}>
                {fetchingMore ? "Chargement…" : "Charger plus"}
              </GhostButton>
            </div>
          ) : null}
        </div>
      ) : exhaustedSearch ? (
        <EmptyState>
          <p className="font-semibold text-[#1A0F0A]">Aucune association trouvée</p>
          <p className="text-sm mt-1">Essaie un autre nom, ville ou catégorie.</p>
        </EmptyState>
      ) : searching ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <p className="text-xs text-[#8A6B4D] text-center">Recherche en cours…</p>
        </div>
      ) : (
        <EmptyState>
          <p className="font-semibold text-[#1A0F0A]">Aucune association</p>
        </EmptyState>
      )}

      {modal ? (
        <CertifyModal
          association={modal.association}
          mode={modal.mode}
          onClose={() => setModal(null)}
          onDone={handleDone}
        />
      ) : null}
    </section>
  );
}
