"use client";

// "Newsletter" — admin console for the launch waitlist + campaigns.
//   - Stats (abonnés / désinscrits)
//   - Composer: create a draft from a subject + a plain-text message
//   - Campaign list: send a test, send to all, delete drafts, watch progress
//
// Plain-text composition (no HTML editor): the admin types a message, we escape
// it and turn line breaks into paragraphs client-side, so a campaign can never
// inject markup into the email layout.

import { useCallback, useEffect, useState } from "react";
import { Mail, Send, Trash2, Users, UserMinus, Megaphone } from "lucide-react";
import {
  AdminApiError,
  createCampaign,
  deleteCampaign,
  fetchCampaigns,
  fetchNewsletterStats,
  fetchSubscribers,
  sendCampaign,
  sendTestCampaign,
  type CampaignStatus,
  type NewsletterCampaign,
  type NewsletterStats,
  type NewsletterSubscriber,
} from "@/lib/adminApi";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorBanner,
  formatDate,
  GhostButton,
  PrimaryButton,
  Skeleton,
  StatCard,
  StatusChip,
  type ChipTone,
} from "./ui";

// Plain text → escaped HTML paragraphs (one <p> per non-empty line block).
function textToHtml(text: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map(
      (para) =>
        `<p style="margin:0 0 16px;">${esc(para).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");
}

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Brouillon",
  sending: "Envoi en cours",
  sent: "Envoyée",
  failed: "Échec",
};

const STATUS_TONE: Record<CampaignStatus, ChipTone> = {
  draft: "neutral",
  sending: "amber",
  sent: "green",
  failed: "red",
};

export default function NewsletterSection() {
  const [stats, setStats] = useState<NewsletterStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [campaigns, setCampaigns] = useState<NewsletterCampaign[] | null>(null);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);

  const [subscribers, setSubscribers] = useState<NewsletterSubscriber[] | null>(
    null,
  );
  const [subsError, setSubsError] = useState<string | null>(null);

  const reloadStats = useCallback((signal?: AbortSignal) => {
    fetchNewsletterStats(signal)
      .then((s) => {
        setStats(s);
        setStatsError(null);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setStatsError(e instanceof AdminApiError ? e.message : "Erreur de chargement.");
      });
  }, []);

  const reloadCampaigns = useCallback((signal?: AbortSignal) => {
    fetchCampaigns(signal)
      .then((c) => {
        setCampaigns(c);
        setCampaignsError(null);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setCampaignsError(
          e instanceof AdminApiError ? e.message : "Erreur de chargement.",
        );
      });
  }, []);

  const reloadSubscribers = useCallback((signal?: AbortSignal) => {
    fetchSubscribers("subscribed", undefined, signal)
      .then((r) => {
        setSubscribers(r.items);
        setSubsError(null);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setSubsError(e instanceof AdminApiError ? e.message : "Erreur de chargement.");
      });
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    reloadStats(ac.signal);
    reloadCampaigns(ac.signal);
    reloadSubscribers(ac.signal);
    return () => ac.abort();
  }, [reloadStats, reloadCampaigns, reloadSubscribers]);

  // While any campaign is sending, poll progress every 3s.
  useEffect(() => {
    if (!campaigns?.some((c) => c.status === "sending")) return;
    const id = setInterval(() => reloadCampaigns(), 3000);
    return () => clearInterval(id);
  }, [campaigns, reloadCampaigns]);

  return (
    <div className="space-y-6">
      {/* Stats */}
      {statsError && !stats ? (
        <ErrorBanner message={statsError} onRetry={() => reloadStats()} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={Users}
            label="Abonnés"
            value={stats?.subscribed ?? 0}
            sublabel="Recevront les campagnes"
          />
          <StatCard
            icon={UserMinus}
            label="Désinscrits"
            value={stats?.unsubscribed ?? 0}
          />
          <StatCard icon={Mail} label="Total collecté" value={stats?.total ?? 0} />
        </div>
      )}

      {/* Composer */}
      <Composer
        onCreated={() => {
          reloadCampaigns();
        }}
      />

      {/* Campaigns */}
      <Card className="p-5">
        <CardHeader
          icon={Megaphone}
          title="Campagnes"
          subtitle="Brouillons et envois"
        />
        {campaignsError && !campaigns ? (
          <ErrorBanner message={campaignsError} onRetry={() => reloadCampaigns()} />
        ) : !campaigns ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <p className="text-sm text-[#8A6B4D] py-2">
            Aucune campagne. Crée un brouillon ci-dessus.
          </p>
        ) : (
          <ul className="space-y-3">
            {campaigns.map((c) => (
              <CampaignRow
                key={c.id}
                campaign={c}
                onChanged={() => {
                  reloadCampaigns();
                  reloadStats();
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      {/* Subscriber list */}
      <Card className="p-5">
        <CardHeader
          icon={Users}
          title="Derniers abonnés"
          subtitle="50 inscriptions les plus récentes"
        />
        {subsError && !subscribers ? (
          <ErrorBanner message={subsError} onRetry={() => reloadSubscribers()} />
        ) : !subscribers ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : subscribers.length === 0 ? (
          <EmptyState>Aucun abonné pour l&apos;instant.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-[#8A6B4D]">
                  <th className="py-2 pr-4 font-semibold">Email</th>
                  <th className="py-2 pr-4 font-semibold">Source</th>
                  <th className="py-2 font-semibold">Inscrit le</th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map((s) => (
                  <tr key={s.id} className="border-t border-[#F1E9DD]">
                    <td className="py-2 pr-4 text-[#1A0F0A]">{s.email}</td>
                    <td className="py-2 pr-4 text-[#5A4634]">{s.source ?? "—"}</td>
                    <td className="py-2 text-[#5A4634] whitespace-nowrap">
                      {formatDate(s.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------
// Composer
// --------------------------------------------------------------------------
function Composer({ onCreated }: { onCreated: () => void }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!subject.trim() || !message.trim()) {
      setError("Sujet et message requis.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createCampaign({
        subject: subject.trim(),
        bodyHtml: textToHtml(message),
        bodyText: message.trim(),
      });
      setSubject("");
      setMessage("");
      onCreated();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Échec de la création.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <CardHeader
        icon={Mail}
        title="Nouvelle campagne"
        subtitle="Le message est mis en forme dans le gabarit NigerConnect."
      />
      <div className="space-y-3">
        <div>
          <label
            htmlFor="nl-subject"
            className="block text-xs font-semibold text-[#5A4634] mb-1"
          >
            Sujet
          </label>
          <input
            id="nl-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            placeholder="NigerConnect est lancé ! 🇳🇪"
            className="w-full rounded-lg border border-[#E8DFD3] bg-[#FDFBF7] px-3 py-2 text-sm text-[#1A0F0A] outline-none focus:border-[#E05206] focus:ring-2 focus:ring-[#E05206]/20"
          />
        </div>
        <div>
          <label
            htmlFor="nl-message"
            className="block text-xs font-semibold text-[#5A4634] mb-1"
          >
            Message
          </label>
          <textarea
            id="nl-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            placeholder={"Bonjour,\n\nL'application est enfin disponible…"}
            className="w-full rounded-lg border border-[#E8DFD3] bg-[#FDFBF7] px-3 py-2 text-sm text-[#1A0F0A] outline-none focus:border-[#E05206] focus:ring-2 focus:ring-[#E05206]/20 resize-y"
          />
          <p className="mt-1 text-xs text-[#8A6B4D]">
            Laisse une ligne vide pour séparer les paragraphes.
          </p>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex justify-end">
          <PrimaryButton onClick={create} disabled={busy}>
            {busy ? "Création…" : "Créer le brouillon"}
          </PrimaryButton>
        </div>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------
// Campaign row
// --------------------------------------------------------------------------
function CampaignRow({
  campaign,
  onChanged,
}: {
  campaign: NewsletterCampaign;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDraft = campaign.status === "draft";

  async function onTest() {
    const email = window.prompt("Adresse email pour le test :");
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      await sendTestCampaign(campaign.id, email.trim());
      window.alert("Email de test envoyé.");
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Échec de l'envoi de test.");
    } finally {
      setBusy(false);
    }
  }

  async function onSend() {
    if (
      !window.confirm(
        `Envoyer « ${campaign.subject} » à tous les abonnés ? Action irréversible.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await sendCampaign(campaign.id);
      window.alert(`Envoi lancé vers ${res.totalRecipients} abonné(s).`);
      onChanged();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Échec du lancement.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!window.confirm("Supprimer ce brouillon ?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCampaign(campaign.id);
      onChanged();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : "Échec de la suppression.");
    } finally {
      setBusy(false);
    }
  }

  const progress =
    campaign.totalRecipients > 0
      ? Math.round((campaign.sentCount / campaign.totalRecipients) * 100)
      : 0;

  return (
    <li className="rounded-xl border border-[#E8DFD3] p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[#1A0F0A] truncate">
              {campaign.subject}
            </span>
            <StatusChip tone={STATUS_TONE[campaign.status]}>
              {STATUS_LABEL[campaign.status]}
            </StatusChip>
          </div>
          <p className="text-xs text-[#8A6B4D] mt-1">
            Créée le {formatDate(campaign.createdAt)}
            {campaign.status !== "draft"
              ? ` · ${campaign.sentCount}/${campaign.totalRecipients} envoyés${
                  campaign.failedCount > 0 ? ` · ${campaign.failedCount} échecs` : ""
                }`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <GhostButton onClick={onTest} disabled={busy}>
            Test
          </GhostButton>
          {isDraft ? (
            <>
              <PrimaryButton onClick={onSend} disabled={busy}>
                <span className="inline-flex items-center gap-1.5">
                  <Send size={14} aria-hidden="true" /> Envoyer
                </span>
              </PrimaryButton>
              <GhostButton onClick={onDelete} disabled={busy} tone="danger">
                <Trash2 size={14} aria-hidden="true" />
              </GhostButton>
            </>
          ) : null}
        </div>
      </div>

      {campaign.status === "sending" ? (
        <div className="mt-3">
          <div className="h-2 w-full rounded-full bg-[#F1E9DD] overflow-hidden">
            <div
              className="h-full bg-[#E05206] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-[#B91C1C]">
          {error}
        </p>
      ) : null}
    </li>
  );
}
