"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutDashboard, LifeBuoy, Mail, ShieldCheck } from "lucide-react";
import {
  clearSession,
  ROLE_KEY,
  type AdminRole,
} from "@/lib/adminApi";
import OverviewSection from "@/components/admin/OverviewSection";
import IdentitySection from "@/components/admin/IdentitySection";
import ReportsSection from "@/components/admin/ReportsSection";
import NewsletterSection from "@/components/admin/NewsletterSection";
import { Sidebar, type NavEntry } from "@/components/admin/Sidebar";

type Tab = "overview" | "identity" | "reports" | "newsletter";

// Newsletter is admin-only on the API. A moderator hitting it would 403 →
// adminFetch bounces to login, so the tab is gated to admins below.
const NAV: NavEntry[] = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "identity", label: "Identité", icon: ShieldCheck },
  { id: "reports", label: "Support & Modération", icon: LifeBuoy },
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

  function logout() {
    clearSession();
    router.replace("/admin/login");
  }

  const nav = role === "admin" ? [...NAV, ...ADMIN_ONLY_NAV] : NAV;

  return (
    <div className="lg:pl-64">
      <Sidebar
        items={nav}
        active={tab}
        onSelect={(id) => setTab(id as Tab)}
        role={role}
        onLogout={logout}
      />

      <main className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto">
        {tab === "overview" ? <OverviewSection /> : null}
        {tab === "identity" ? <IdentitySection /> : null}
        {tab === "reports" ? <ReportsSection /> : null}
        {tab === "newsletter" ? <NewsletterSection /> : null}
      </main>
    </div>
  );
}
