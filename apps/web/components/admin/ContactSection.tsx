"use client";

// Boîte de réception « Nous contacter » : partenariats, demandes d'info, soucis
// remontés depuis l'app. Un mail de notification part aussi vers contact@ — cette
// section sert à suivre ce qui a été traité, ce que le mail ne sait pas faire.

import { useCallback, useEffect, useState } from "react";
import { Inbox, Mail, Phone } from "lucide-react";
import {
  AdminApiError,
  fetchContactMessages,
  setContactStatus,
  type ContactMessage,
  type ContactStatus,
  type ContactTopic,
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
} from "./ui";

const TOPIC_LABEL: Record<ContactTopic, string> = {
  partnership: "Partenariat",
  info: "Information",
  problem: "Problème",
  other: "Autre",
};

const FILTERS: { value: ContactStatus | "all"; label: string }[] = [
  { value: "new", label: "Nouveaux" },
  { value: "read", label: "Lus" },
  { value: "handled", label: "Traités" },
  { value: "all", label: "Tous" },
];

function SectionHeader({ count }: { count: number }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div>
        <h2 className="text-xl font-bold text-[#1A0F0A]">Contact & partenariats</h2>
        <p className="text-sm text-[#8A6B4D] mt-0.5">
          Messages envoyés depuis l&apos;app — une copie part aussi par email.
        </p>
      </div>
      {count > 0 ? (
        <StatusChip tone="amber">
          <span className="tabular-nums">{count}</span> nouveau{count > 1 ? "x" : ""}
        </StatusChip>
      ) : null}
    </div>
  );
}

function CardSkeleton() {
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-28 rounded-full" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-16 w-full" />
    </Card>
  );
}

function MessageCard({
  item,
  onStatus,
}: {
  item: ContactMessage;
  onStatus: (id: string, status: ContactStatus) => void;
}) {
  const senderName = item.user?.displayName ?? item.user?.firstName ?? "Sans compte";

  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusChip tone={item.topic === "partnership" ? "green" : "neutral"}>
            {TOPIC_LABEL[item.topic]}
          </StatusChip>
          {item.status === "new" ? <StatusChip tone="amber">Nouveau</StatusChip> : null}
          {item.status === "handled" ? <StatusChip tone="green">Traité</StatusChip> : null}
        </div>
        <span className="text-xs text-[#8A6B4D]">{formatDate(item.createdAt)}</span>
      </div>

      <div className="flex items-center gap-2 text-sm text-[#5A4634]">
        <Avatar src={item.user?.avatarUrl ?? null} name={senderName} size={24} />
        <span className="text-[#1A0F0A] font-semibold">{senderName}</span>
      </div>

      <div>
        <p className="font-bold text-[#1A0F0A]">{item.subject}</p>
        <p className="mt-2 text-sm text-[#1A0F0A] whitespace-pre-wrap break-words">
          {item.message}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <a
          href={`mailto:${item.email}?subject=${encodeURIComponent(`Re: ${item.subject}`)}`}
          className="inline-flex items-center gap-1.5 text-[#E05206] hover:underline"
        >
          <Mail size={15} aria-hidden="true" />
          {item.email}
        </a>
        {item.phone ? (
          <a
            href={`tel:${item.phone}`}
            className="inline-flex items-center gap-1.5 text-[#5A4634] hover:underline"
          >
            <Phone size={15} aria-hidden="true" />
            {item.phone}
          </a>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {item.status !== "handled" ? (
          <PrimaryButton onClick={() => onStatus(item.id, "handled")}>
            Marquer traité
          </PrimaryButton>
        ) : (
          <GhostButton onClick={() => onStatus(item.id, "new")}>Rouvrir</GhostButton>
        )}
        {item.status === "new" ? (
          <GhostButton onClick={() => onStatus(item.id, "read")}>Marquer lu</GhostButton>
        ) : null}
      </div>
    </Card>
  );
}

export default function ContactSection() {
  const [items, setItems] = useState<ContactMessage[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [filter, setFilter] = useState<ContactStatus | "all">("new");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (status: ContactStatus | "all", signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchContactMessages(status, signal);
        setItems(res.items);
        setNewCount(res.newCount);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof AdminApiError ? e.message : "Erreur de chargement.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(filter, ac.signal);
    return () => ac.abort();
  }, [load, filter]);

  async function changeStatus(id: string, status: ContactStatus) {
    try {
      await setContactStatus(id, status);
      // Le message quitte la liste dès qu'il ne correspond plus au filtre actif.
      setItems((prev) =>
        filter === "all" ? prev.map((i) => (i.id === id ? { ...i, status } : i)) : prev.filter((i) => i.id !== id),
      );
      setNewCount((c) => (status === "new" ? c + 1 : Math.max(0, c - 1)));
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Action impossible.");
    }
  }

  const header = <SectionHeader count={newCount} />;

  const filters = (
    <div className="flex flex-wrap gap-2 mb-4">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          onClick={() => setFilter(f.value)}
          className={
            filter === f.value
              ? "px-3 py-1.5 rounded-full text-xs font-bold bg-[#E05206] text-white"
              : "px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-[#5A4634] border border-[#E8DFD3] hover:border-[#E05206]"
          }
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  if (loading && items.length === 0)
    return (
      <div>
        {header}
        {filters}
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );

  if (error && items.length === 0)
    return (
      <div>
        {header}
        {filters}
        <ErrorBanner message={error} onRetry={() => void load(filter)} />
      </div>
    );

  if (items.length === 0)
    return (
      <div>
        {header}
        {filters}
        <EmptyState>
          <div className="flex flex-col items-center gap-2 text-[#8A6B4D]">
            <Inbox size={28} strokeWidth={1.75} aria-hidden="true" />
            <span>Aucun message dans cette vue</span>
          </div>
        </EmptyState>
      </div>
    );

  return (
    <div>
      {header}
      {filters}
      {error ? <ErrorBanner message={error} onRetry={() => void load(filter)} /> : null}
      <div className="space-y-4">
        {items.map((item) => (
          <MessageCard key={item.id} item={item} onStatus={(id, s) => void changeStatus(id, s)} />
        ))}
      </div>
    </div>
  );
}
