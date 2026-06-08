"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchMetrics,
  AdminApiError,
  type AdminMetrics,
} from "@/lib/adminApi";
import { Card, ErrorBanner, SectionTitle, Spinner } from "./ui";

interface Stat {
  label: string;
  value: number;
}

function StatGrid({ title, stats }: { title: string; stats: Stat[] }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-2xl font-bold text-[#1A0F0A] tabular-nums">
              {s.value.toLocaleString("fr-FR")}
            </div>
            <div className="text-xs text-[#5A4634] mt-1">{s.label}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function MetricsSection() {
  const [data, setData] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const metrics = await fetchMetrics(signal);
      setData(metrics);
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

  if (loading && !data) return <Spinner label="Chargement des métriques…" />;
  if (error && !data)
    return <ErrorBanner message={error} onRetry={() => void load()} />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      <StatGrid
        title="Utilisateurs"
        stats={[
          { label: "Total", value: data.users.total },
          { label: "Email vérifié", value: data.users.emailVerified },
          { label: "Identité validée", value: data.users.identityApproved },
          { label: "Inscriptions 24h", value: data.users.signups24h },
          { label: "Inscriptions 7j", value: data.users.signups7d },
        ]}
      />
      <StatGrid
        title="Identité"
        stats={[
          { label: "En attente", value: data.identity.pending },
          { label: "Validées", value: data.identity.approved },
          { label: "Rejetées", value: data.identity.rejected },
        ]}
      />
      <StatGrid
        title="Contenu"
        stats={[
          { label: "Publications", value: data.content.posts },
          { label: "Messages 24h", value: data.content.messages24h },
          { label: "Commentaires", value: data.content.comments },
        ]}
      />
      <StatGrid
        title="Modération"
        stats={[
          { label: "Signalements en attente", value: data.moderation.reportsPending },
        ]}
      />
    </div>
  );
}
