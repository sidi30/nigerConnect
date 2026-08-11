"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Award,
  BadgeCheck,
  LayoutDashboard,
  Inbox,
  LifeBuoy,
  Lock,
  Mail,
  MapIcon,
  Network,
  ShieldCheck,
  UserCog,
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
import DobBackfillSection from "@/components/admin/DobBackfillSection";
import ReportsSection from "@/components/admin/ReportsSection";
import ContactSection from "@/components/admin/ContactSection";
import NewsletterSection from "@/components/admin/NewsletterSection";
import InvitationsSection from "@/components/admin/InvitationsSection";
import ReferralsSection from "@/components/admin/ReferralsSection";
import AmbassadorsSection from "@/components/admin/AmbassadorsSection";
import OfficialSection from "@/components/admin/OfficialSection";
import UsersSection from "@/components/admin/UsersSection";
import SecuritySection from "@/components/admin/SecuritySection";
import ObservabilitySection from "@/components/admin/ObservabilitySection";
import MapSection from "@/components/admin/MapSection";
import { Sidebar, type NavEntry } from "@/components/admin/Sidebar";

type Tab =
  | "overview"
  | "identity"
  | "users"
  | "reports"
  | "contact"
  | "newsletter"
  | "invitations"
  | "referrals"
  | "ambassadors"
  | "official"
  | "security"
  | "observability"
  | "map";

// Newsletter is admin-only on the API. A moderator hitting it would 403 →
// adminFetch bounces to login, so the tab is gated to admins below.
// Invitations and Referrals sections are visible to both admin and moderator
// (metrics are readable by both; settings write is admin-only and handled
// inside the component).
const NAV: NavEntry[] = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "identity", label: "Identité", icon: ShieldCheck },
  { id: "users", label: "Utilisateurs", icon: UserCog },
  { id: "reports", label: "Support & Modération", icon: LifeBuoy },
  { id: "contact", label: "Contact & partenariats", icon: Inbox },
  { id: "invitations", label: "Invitations", icon: Users },
  { id: "referrals", label: "Réseau", icon: Network },
  { id: "security", label: "Sécurité", icon: Lock },
];

// Observabilité est admin-only côté API (les logs portent des userId, des IP et
// des stack traces) — la garder hors du NAV partagé évite un 403 → déconnexion.
// La carte expose la position (même approchée) de chaque membre et le bris de
// glace GPS : même raisonnement que l'observabilité, on la garde admin-only
// plutôt que de risquer un 403 → déconnexion pour un modérateur.
const ADMIN_ONLY_NAV: NavEntry[] = [
  { id: "map", label: "Carte", icon: MapIcon },
  { id: "ambassadors", label: "Ambassadeurs", icon: Award },
  { id: "official", label: "Compte officiel", icon: BadgeCheck },
  { id: "newsletter", label: "Newsletter", icon: Mail },
  { id: "observability", label: "Observabilité", icon: Activity },
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
        {tab === "overview" ? <OverviewSection onNavigate={setTab} /> : null}
        {tab === "identity" ? (
          <div className="space-y-6">
            <IdentitySection />
            <DobBackfillSection />
          </div>
        ) : null}
        {tab === "users" ? <UsersSection role={role} /> : null}
        {tab === "map" ? (
          <MapSection role={role} onOpenUsersSection={() => setTab("users")} />
        ) : null}
        {tab === "reports" ? <ReportsSection /> : null}
        {tab === "contact" ? <ContactSection /> : null}
        {tab === "newsletter" ? <NewsletterSection /> : null}
        {tab === "invitations" ? <InvitationsSection role={role} /> : null}
        {tab === "referrals" ? <ReferralsSection /> : null}
        {tab === "ambassadors" ? <AmbassadorsSection /> : null}
        {tab === "official" ? <OfficialSection /> : null}
        {tab === "security" ? <SecuritySection role={role} /> : null}
        {tab === "observability" ? <ObservabilitySection /> : null}
      </main>
    </div>
  );
}
