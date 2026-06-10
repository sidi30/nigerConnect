"use client";

// Conversion funnel — stepped horizontal bars with the share of the top of
// funnel as bar width, plus the step-to-step conversion % between rows.
// Pure CSS (no chart lib) so it stays crisp and accessible.

import { ChevronDown } from "lucide-react";
import { chartColors, fmt } from "./ui";

export interface FunnelStep {
  label: string;
  value: number;
}

export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const top = steps[0]?.value ?? 0;

  if (steps.length === 0 || top === 0) {
    return (
      <div className="h-32 grid place-items-center text-sm text-[#8A6B4D]">
        Aucune donnée
      </div>
    );
  }

  return (
    <ol className="space-y-1">
      {steps.map((step, i) => {
        const widthPct = top > 0 ? Math.max((step.value / top) * 100, 2) : 0;
        const sharePct = top > 0 ? Math.round((step.value / top) * 100) : 0;
        const prev = i > 0 ? steps[i - 1].value : null;
        const stepConv =
          prev && prev > 0 ? Math.round((step.value / prev) * 100) : null;
        const color = chartColors[i % chartColors.length];

        return (
          <li key={step.label}>
            {i > 0 ? (
              <div className="flex items-center gap-1.5 pl-1 py-1 text-xs text-[#8A6B4D]">
                <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
                <span className="tabular-nums">
                  {stepConv !== null
                    ? `${stepConv}% de conversion`
                    : "—"}
                </span>
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3 mb-1">
                  <span className="text-sm font-semibold text-[#1A0F0A] truncate">
                    {step.label}
                  </span>
                  <span className="text-xs text-[#8A6B4D] tabular-nums shrink-0">
                    {sharePct}%
                  </span>
                </div>
                <div className="h-7 w-full rounded-lg bg-[#F1E9DD] overflow-hidden">
                  <div
                    className="h-full rounded-lg flex items-center px-2 transition-[width]"
                    style={{ width: `${widthPct}%`, background: color }}
                  >
                    <span className="text-xs font-bold text-white tabular-nums drop-shadow-sm">
                      {fmt(step.value)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
