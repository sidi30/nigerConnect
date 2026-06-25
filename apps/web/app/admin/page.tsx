"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  LifeBuoy,
  Mail,
  Network,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  clearSession,
  ROLE_KEY,
  type AdminRole,
} from "@/lib/adminApi";
import { useAdminNotifications } from "@/lib/useAdminNotifications";
import OverviewSection from "@/components/admin/OverviewSection";
import IdentitySection from "@/components/admin/IdentitySection";
import ReportsSection from "@/components/admin/ReportsSection";
import NewsletterSection from "@/components/admin/NewsletterSection";
import InvitationsSection from "@/components/admin/InvitationsSection";
import ReferralsSection from "@/components/admin/ReferralsSection";
import { Sidebar, type NavEntry } from "@/components/admin/Sidebar";

type Tab =
  | "overview"
  | "identity"
  | "reports"
  | "newsletter"
  | "invitations"
  | "referrals";

// Newsletter is admin-only on the API. A moderator hitting it would 403 →
// adminFetch bounces to login, so the tab is gated to admins below.
// Invitations and Referrals sections are visible to both admin and moderator
// (metrics are readable by both; settings write is admin-only and handled
// inside the component).
const NAV: NavEntry[] = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "identity", label: "Identité", icon: ShieldCheck },
  { id: "reports", label: "Support & Modération", icon: LifeBuoy },
  { id: "invitations", label: "Invitations", icon: Users },
  { id: "referrals", label: "Réseau", icon: Network },
];

const ADMIN_ONLY_NAV: NavEntry[] = [
  { id: "newsletter", label: "Newsletter", icon: Mail },
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [role, setRole] = useState<AdminRole | null>(null);

  // Role badge — read once from localStorage on mount (client-only).
  useEffect(() => {
    const r = window.localStorage.getItem(ROLE_KEY);
    if (r === "admin" || r === "moderator" || r === "user") setRole(r);
  }, []);

  // Live action-queue counts (poll once the role/session is resolved).
  const counts = useAdminNotifications(role !== null);

  function logout() {
    clearSession();
    router.replace("/admin/login");
  }

  const baseNav = role === "admin" ? [...NAV, ...ADMIN_ONLY_NAV] : NAV;
  const nav: NavEntry[] = baseNav.map((entry) => {
    if (entry.id === "identity")
      return { ...entry, badge: counts.identityPending };
    if (entry.id === "reports")
      return { ...entry, badge: counts.reportsPending };
    return entry;
  });

  // Screen-reader announcement: re-announced only when the text actually
  // changes (identical text = no DOM mutation = no re-announce).
  const announcement = [
    counts.identityPending > 0
      ? `${counts.identityPending} pièce(s) d'identité en attente`
      : null,
    counts.reportsPending > 0
      ? `${counts.reportsPending} signalement(s) en attente`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="lg:pl-64">
      <Sidebar
        items={nav}
        active={tab}
        onSelect={(id) => setTab(id as Tab)}
        role={role}
        onLogout={logout}
      />

      {/* Polite live region: announces queue changes without stealing focus. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <main className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto">
        {tab === "overview" ? <OverviewSection /> : null}
        {tab === "identity" ? <IdentitySection /> : null}
        {tab === "reports" ? <ReportsSection /> : null}
        {tab === "newsletter" ? <NewsletterSection /> : null}
        {tab === "invitations" ? <InvitationsSection role={role} /> : null}
        {tab === "referrals" ? <ReferralsSection /> : null}
      </main>
    </div>
  );
}
