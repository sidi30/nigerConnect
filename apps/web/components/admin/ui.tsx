"use client";

// Small, dependency-free UI primitives shared across the admin sections.
// Kept intentionally plain — this is an internal tool, clarity over flourish.

import type { ComponentType, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

// Brand palette tokens, surfaced once so chart wrappers and primitives stay
// in sync. Kept as plain strings (Recharts needs raw color values).
export const palette = {
  primary: "#E05206",
  primaryHover: "#C8470A",
  bg: "#FDFBF7",
  surface: "#FFFFFF",
  border: "#E8DFD3",
  ink: "#1A0F0A",
  muted: "#5A4634",
  faint: "#8A6B4D",
  // Status hues (kept readable on the warm surface, contrast ≥ 4.5:1 for text).
  amber: "#B45309",
  amberSoft: "#FEF3E2",
  green: "#15803D",
  greenSoft: "#E7F4EC",
  red: "#B91C1C",
  redSoft: "#FCE8E8",
  blue: "#1D4ED8",
  blueSoft: "#E6EDFB",
} as const;

// Categorical series colors for charts — distinct enough to be told apart
// without relying on hue alone (every chart also labels its slices/series).
export const chartColors = [
  "#E05206", // brand orange
  "#1D4ED8", // blue
  "#15803D", // green
  "#B45309", // amber
  "#7C3AED", // violet
  "#0E7490", // teal
  "#BE123C", // rose
  "#A16207", // gold
] as const;

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-[0_1px_2px_rgba(26,15,10,0.04),0_4px_16px_-8px_rgba(26,15,10,0.10)] border border-[#E8DFD3] ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-lg font-bold text-[#1A0F0A] mb-3">{children}</h2>
  );
}

// Card header with an optional icon + subtitle + right-aligned slot (actions).
export function CardHeader({
  title,
  subtitle,
  icon: Icon,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ComponentType<LucideProps>;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-start gap-2.5 min-w-0">
        {Icon ? (
          <span className="mt-0.5 grid place-items-center w-8 h-8 rounded-lg bg-[#FDF0E6] text-[#E05206] shrink-0">
            <Icon size={18} strokeWidth={2} aria-hidden="true" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-[#1A0F0A] leading-tight">
            {title}
          </h3>
          {subtitle ? (
            <p className="text-xs text-[#8A6B4D] mt-0.5">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="bg-[#FCE8E8] border border-[#F5C2C2] text-[#8B1F1F] rounded-lg px-4 py-3 text-sm flex items-center justify-between gap-4"
    >
      <span>{message}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="font-semibold underline hover:no-underline shrink-0"
        >
          Réessayer
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Card className="p-8 text-center text-[#8A6B4D]">{children}</Card>
  );
}

export function Spinner({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="text-[#5A4634] text-sm" aria-live="polite">
      {label}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="bg-[#E05206] hover:bg-[#C8470A] disabled:bg-[#E8DFD3] disabled:text-[#A89882] disabled:cursor-not-allowed text-white font-semibold px-4 py-2 rounded-lg transition-colors text-sm"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  tone = "neutral",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger";
  type?: "button" | "submit";
}) {
  const toneClass =
    tone === "danger"
      ? "border-[#F5C2C2] text-[#8B1F1F] hover:bg-[#FCE8E8]"
      : "border-[#E8DFD3] text-[#5A4634] hover:bg-[#FDFBF7]";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`border ${toneClass} disabled:opacity-50 disabled:cursor-not-allowed font-semibold px-4 py-2 rounded-lg transition-colors text-sm`}
    >
      {children}
    </button>
  );
}

// Avatar with graceful fallback to initials. We do not use next/image here —
// avatar/ID URLs are arbitrary external/presigned URLs.
export function Avatar({
  src,
  name,
  size = 40,
}: {
  src: string | null;
  name: string;
  size?: number;
}) {
  const initials = name
    .split(" ")
    .map((p) => p.charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover border border-[#E8DFD3] shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-[#FDF0E6] text-[#E05206] font-semibold flex items-center justify-center shrink-0 border border-[#E8DFD3]"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initials || "?"}
    </div>
  );
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// fr-FR integer formatting, used everywhere a number is shown.
export function fmt(n: number): string {
  return n.toLocaleString("fr-FR");
}

// ---------------------------------------------------------------------------
// Skeleton — shimmering placeholder. `prefers-reduced-motion` users get a
// static block (no pulse). The animation utility is gated in globals via the
// `motion-safe:` variant so we don't need a JS check here.
// ---------------------------------------------------------------------------

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-[#F1E9DD] rounded-md motion-safe:animate-pulse ${className}`}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// DeltaBadge — signed percentage vs a previous period. Never color-only:
// always carries an arrow icon + explicit sign, plus an aria-label.
// ---------------------------------------------------------------------------

export function DeltaBadge({
  value,
  previous,
}: {
  value: number;
  previous: number;
}) {
  // Compute % change. When previous is 0 we show "nouveau" if there's any
  // activity, otherwise a flat 0%.
  let pct: number | null;
  if (previous === 0) {
    pct = value === 0 ? 0 : null;
  } else {
    pct = ((value - previous) / previous) * 100;
  }

  const dir =
    pct === null ? "up" : pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;

  const tone =
    dir === "up"
      ? "bg-[#E7F4EC] text-[#15803D]"
      : dir === "down"
        ? "bg-[#FCE8E8] text-[#B91C1C]"
        : "bg-[#F1E9DD] text-[#5A4634]";

  const text =
    pct === null
      ? "nouveau"
      : `${pct > 0 ? "+" : ""}${pct.toLocaleString("fr-FR", {
          maximumFractionDigits: 1,
        })} %`;

  const label =
    pct === null
      ? "Nouvelle activité par rapport à la période précédente"
      : `${pct >= 0 ? "Hausse" : "Baisse"} de ${Math.abs(pct).toFixed(
          1,
        )} % par rapport à la période précédente`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`}
      aria-label={label}
    >
      <Icon size={13} strokeWidth={2.5} aria-hidden="true" />
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatusChip — labelled status pill. Tone + icon optional. Text label always
// present so meaning never depends on color alone.
// ---------------------------------------------------------------------------

export type ChipTone =
  | "amber"
  | "green"
  | "red"
  | "blue"
  | "neutral"
  | "brand";

const CHIP_TONES: Record<ChipTone, string> = {
  amber: "bg-[#FEF3E2] text-[#B45309]",
  green: "bg-[#E7F4EC] text-[#15803D]",
  red: "bg-[#FCE8E8] text-[#B91C1C]",
  blue: "bg-[#E6EDFB] text-[#1D4ED8]",
  neutral: "bg-[#F1E9DD] text-[#5A4634]",
  brand: "bg-[#FDF0E6] text-[#E05206]",
};

export function StatusChip({
  children,
  tone = "neutral",
  icon: Icon,
}: {
  children: ReactNode;
  tone?: ChipTone;
  icon?: ComponentType<LucideProps>;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${CHIP_TONES[tone]}`}
    >
      {Icon ? <Icon size={13} strokeWidth={2.5} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StatCard — KPI tile: label, big value, optional sublabel, optional delta
// badge, and an optional inline chart slot (sparkline) rendered bottom-right.
// ---------------------------------------------------------------------------

export function StatCard({
  label,
  value,
  icon: Icon,
  sublabel,
  delta,
  spark,
  accent = false,
}: {
  label: string;
  value: number;
  icon?: ComponentType<LucideProps>;
  sublabel?: ReactNode;
  delta?: ReactNode;
  spark?: ReactNode;
  accent?: boolean;
}) {
  return (
    <Card
      className={`p-4 sm:p-5 relative overflow-hidden ${
        accent ? "ring-1 ring-[#E05206]/30 bg-[#FFF8F3]" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {Icon ? (
            <span
              className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${
                accent
                  ? "bg-[#E05206] text-white"
                  : "bg-[#FDF0E6] text-[#E05206]"
              }`}
            >
              <Icon size={18} strokeWidth={2} aria-hidden="true" />
            </span>
          ) : null}
          <span className="text-xs font-semibold text-[#8A6B4D] uppercase tracking-wide truncate">
            {label}
          </span>
        </div>
        {delta ?? null}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-3xl font-bold text-[#1A0F0A] tabular-nums leading-none">
            {value.toLocaleString("fr-FR")}
          </div>
          {sublabel ? (
            <div className="text-xs text-[#5A4634] mt-1.5">{sublabel}</div>
          ) : null}
        </div>
        {spark ? (
          <div className="w-24 h-10 shrink-0 self-end -mb-1" aria-hidden="true">
            {spark}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SidebarItem — nav row for the admin shell. Works as a button (tab state).
// ---------------------------------------------------------------------------

export function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: ComponentType<LucideProps>;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E05206] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FDFBF7] ${
        active
          ? "bg-[#FDF0E6] text-[#E05206]"
          : "text-[#5A4634] hover:bg-[#FDFBF7] hover:text-[#1A0F0A]"
      }`}
    >
      <Icon
        size={19}
        strokeWidth={2}
        aria-hidden="true"
        className={active ? "text-[#E05206]" : "text-[#8A6B4D] group-hover:text-[#5A4634]"}
      />
      <span className="flex-1 text-left truncate">{label}</span>
      {badge && badge > 0 ? (
        <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[#E05206] text-white text-[11px] font-bold tabular-nums">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

// Panel state helpers: a consistent empty + loading look for chart cards.
export function PanelEmpty({
  message = "Aucune donnée",
}: {
  message?: string;
}) {
  return (
    <div className="h-full min-h-32 grid place-items-center text-sm text-[#8A6B4D]">
      {message}
    </div>
  );
}
