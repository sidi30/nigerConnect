"use client";

// Small, dependency-free UI primitives shared across the admin sections.
// Kept intentionally plain — this is an internal tool, clarity over flourish.

import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border border-[#E8DFD3] ${className}`}
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
