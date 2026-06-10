"use client";

// Admin app-shell sidebar. On ≥1024px it's a persistent left rail; below that
// it collapses to a top bar with a toggle drawer.

import { useEffect, useState } from "react";
import { LogOut, Menu, ShieldCheck, X } from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import type { AdminRole } from "@/lib/adminApi";
import { SidebarItem } from "./ui";

export interface NavEntry {
  id: string;
  label: string;
  icon: ComponentType<LucideProps>;
  badge?: number;
}

const ROLE_LABEL: Record<AdminRole, string> = {
  admin: "Administrateur",
  moderator: "Modérateur",
  user: "Utilisateur",
};

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-[#E05206] text-white shrink-0">
        <ShieldCheck size={18} strokeWidth={2.25} aria-hidden="true" />
      </span>
      <div className="leading-tight">
        <div className="font-bold text-[#1A0F0A] text-sm">NigerConnect</div>
        <div className="text-[11px] font-semibold text-[#E05206] uppercase tracking-wide">
          Admin
        </div>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: AdminRole | null }) {
  if (!role) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-[#FDFBF7] border border-[#E8DFD3] px-3 py-2">
      <span className="w-2 h-2 rounded-full bg-[#15803D]" aria-hidden="true" />
      <span className="text-xs font-semibold text-[#5A4634]">
        {ROLE_LABEL[role]}
      </span>
    </div>
  );
}

function Nav({
  items,
  active,
  onSelect,
}: {
  items: NavEntry[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Navigation admin" className="space-y-1">
      {items.map((item) => (
        <SidebarItem
          key={item.id}
          icon={item.icon}
          label={item.label}
          active={active === item.id}
          badge={item.badge}
          onClick={() => onSelect(item.id)}
        />
      ))}
    </nav>
  );
}

export function Sidebar({
  items,
  active,
  onSelect,
  role,
  onLogout,
}: {
  items: NavEntry[];
  active: string;
  onSelect: (id: string) => void;
  role: AdminRole | null;
  onLogout: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer whenever the active tab changes (mobile navigation).
  useEffect(() => {
    setDrawerOpen(false);
  }, [active]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const renderRail = (showBrand: boolean) => (
    <div className="flex flex-col h-full">
      {showBrand ? (
        <div className="px-2 pb-5 pt-1">
          <Brand />
        </div>
      ) : null}
      <div className="flex-1 px-1 overflow-y-auto">
        <Nav items={items} active={active} onSelect={onSelect} />
      </div>
      <div className="pt-4 mt-4 border-t border-[#E8DFD3] space-y-3 px-1">
        <RoleBadge role={role} />
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-2 w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-[#5A4634] hover:bg-[#FCE8E8] hover:text-[#B91C1C] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E05206]"
        >
          <LogOut size={18} strokeWidth={2} aria-hidden="true" />
          Déconnexion
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent rail */}
      <aside className="hidden lg:flex lg:flex-col fixed inset-y-0 left-0 w-64 bg-white border-r border-[#E8DFD3] px-4 py-5 z-20">
        {renderRail(true)}
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-20 bg-white border-b border-[#E8DFD3]">
        <div className="flex items-center justify-between px-4 h-14">
          <Brand />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Ouvrir le menu"
            aria-expanded={drawerOpen}
            className="grid place-items-center w-10 h-10 rounded-lg border border-[#E8DFD3] text-[#5A4634] hover:bg-[#FDFBF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E05206]"
          >
            <Menu size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="lg:hidden fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Fermer le menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-[#1A0F0A]/40"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%] bg-white border-r border-[#E8DFD3] px-4 py-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Fermer le menu"
                className="grid place-items-center w-9 h-9 rounded-lg text-[#5A4634] hover:bg-[#FDFBF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E05206]"
              >
                <X size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="h-[calc(100%-3rem)]">{renderRail(false)}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
