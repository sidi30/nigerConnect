"use client";

import { useState } from "react";
import MetricsSection from "@/components/admin/MetricsSection";
import IdentitySection from "@/components/admin/IdentitySection";
import ReportsSection from "@/components/admin/ReportsSection";

type Tab = "metrics" | "identity" | "reports";

const TABS: { id: Tab; label: string }[] = [
  { id: "metrics", label: "Métriques" },
  { id: "identity", label: "Vérification d'identité" },
  { id: "reports", label: "Signalements" },
];

export default function AdminDashboardPage() {
  const [tab, setTab] = useState<Tab>("metrics");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Sections admin"
        className="flex flex-wrap gap-2 mb-6 border-b border-[#E8DFD3]"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
                active
                  ? "border-[#E05206] text-[#E05206]"
                  : "border-transparent text-[#5A4634] hover:text-[#1A0F0A]"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "metrics" ? <MetricsSection /> : null}
      {tab === "identity" ? <IdentitySection /> : null}
      {tab === "reports" ? <ReportsSection /> : null}
    </div>
  );
}
