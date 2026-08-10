"use client";

// Survie des cohortes d'inscription — « est-ce que ceux qui arrivent restent ».
//
// Le reste du tableau de bord additionne des totaux, qui montent tant qu'il
// entre du monde, même si personne ne revient. C'est le seul bloc qui répond à
// la question de l'amorçage.
//
// Forme : une grille cohorte × horizon, donc de la MAGNITUDE sur deux
// dimensions — un dégradé d'une seule teinte, du clair au foncé, jamais un
// arc-en-ciel. C'est déjà un tableau, donc lisible au lecteur d'écran sans
// vue alternative à construire.

import { useCallback, useEffect, useState } from "react";
import { CalendarRange, Users } from "lucide-react";
import {
  AdminApiError,
  fetchRetention,
  type AdminRetention,
  type RetentionCohort,
} from "@/lib/adminApi";
import { Card, CardHeader, ErrorBanner, fmt, Skeleton } from "./ui";

/**
 * Cinq paliers d'une seule teinte (l'orange de la marque), du clair au foncé :
 * plus la part est forte, plus la case est dense. Le texte passe en blanc sur
 * les deux paliers foncés pour rester lisible.
 */
const STEPS: Array<{ min: number; bg: string; fg: string }> = [
  { min: 60, bg: "#B03D04", fg: "#FFFFFF" },
  { min: 40, bg: "#E05206", fg: "#FFFFFF" },
  { min: 20, bg: "#F5A26A", fg: "#1A0F0A" },
  { min: 5, bg: "#FBD9C2", fg: "#1A0F0A" },
  { min: 0, bg: "#FDF0E6", fg: "#8A6B4D" },
];

function cellStyle(value: number | null): { bg: string; fg: string } {
  if (value === null) return { bg: "transparent", fg: "#B59B82" };
  const step = STEPS.find((s) => value >= s.min) ?? STEPS[STEPS.length - 1]!;
  return { bg: step.bg, fg: step.fg };
}

/** « 2026-08-10 » → « 10 août ». */
function weekLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function Cell({ value, size }: { value: number | null; size: number }) {
  const { bg, fg } = cellStyle(value);
  if (value === null) {
    return (
      <td
        className="px-2 py-2 text-center text-xs text-[#B59B82]"
        // Une case vide et une case à 0 % ne disent pas du tout la même chose.
        title="Cette cohorte n'a pas encore atteint cet âge — rien à mesurer."
      >
        —
      </td>
    );
  }
  return (
    <td className="px-1.5 py-1.5">
      <div
        className="rounded-md px-2 py-1.5 text-center text-xs font-bold tabular-nums"
        style={{ backgroundColor: bg, color: fg }}
        title={`${Math.round((value / 100) * size)} membre(s) sur ${size}`}
      >
        {value}%
      </div>
    </td>
  );
}

function Row({ cohort }: { cohort: RetentionCohort }) {
  return (
    <tr className="border-t border-[#F0E6DA]">
      <th
        scope="row"
        className="px-3 py-2 text-left text-xs font-semibold text-[#1A0F0A] whitespace-nowrap"
      >
        {weekLabel(cohort.week)}
      </th>
      <td className="px-3 py-2 text-right text-xs tabular-nums text-[#8A6B4D]">
        {fmt(cohort.size)}
      </td>
      <Cell value={cohort.d1} size={cohort.size} />
      <Cell value={cohort.d7} size={cohort.size} />
      <Cell value={cohort.d30} size={cohort.size} />
    </tr>
  );
}

export default function RetentionCohorts() {
  const [weeks, setWeeks] = useState(12);
  const [data, setData] = useState<AdminRetention | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      fetchRetention(weeks, signal)
        .then(setData)
        .catch((e) => {
          if (signal?.aborted) return;
          setError(
            e instanceof AdminApiError ? e.message : "Chargement impossible.",
          );
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [weeks],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHeader
          icon={CalendarRange}
          title="Rétention par cohorte"
          subtitle="Part des inscrits d'une semaine encore active N jours après"
        />
        <div className="flex gap-1">
          {[8, 12, 26].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWeeks(w)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                weeks === w
                  ? "bg-[#E05206] text-white"
                  : "bg-[#FFF8F3] text-[#8A6B4D] border border-[#E8DFD3] hover:bg-[#FEF3E2]"
              }`}
            >
              {w} sem.
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <Skeleton className="h-64 w-full rounded-xl mt-4" />
      ) : error ? (
        <div className="mt-4">
          <ErrorBanner message={error} onRetry={() => load()} />
        </div>
      ) : !data || data.cohorts.length === 0 ? (
        <p className="mt-6 text-sm text-[#8A6B4D]">
          Aucune inscription sur la période.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { label: "à 1 jour", value: data.overall.d1 },
              { label: "à 7 jours", value: data.overall.d7 },
              { label: "à 30 jours", value: data.overall.d30 },
            ].map((k) => (
              <div
                key={k.label}
                className="rounded-xl border border-[#E8DFD3] bg-[#FFF8F3] px-3 py-2.5"
              >
                <p className="text-2xl font-bold text-[#1A0F0A] tabular-nums leading-none">
                  {k.value === null ? "—" : `${k.value}%`}
                </p>
                <p className="text-xs text-[#8A6B4D] mt-1">encore là {k.label}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto mt-4">
            <table className="w-full min-w-[26rem] border-collapse">
              <caption className="sr-only">
                Part des membres inscrits chaque semaine encore actifs 1, 7 et 30
                jours après leur inscription
              </caption>
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-[#8A6B4D]">
                  <th scope="col" className="px-3 py-2 text-left font-semibold">
                    Semaine
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3 h-3" aria-hidden="true" /> Inscrits
                    </span>
                  </th>
                  <th scope="col" className="px-2 py-2 text-center font-semibold">
                    J+1
                  </th>
                  <th scope="col" className="px-2 py-2 text-center font-semibold">
                    J+7
                  </th>
                  <th scope="col" className="px-2 py-2 text-center font-semibold">
                    J+30
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map((c) => (
                  <Row key={c.week} cohort={c} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 pt-3 border-t border-[#F0E6DA]">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[#8A6B4D]">Faible</span>
              {[...STEPS].reverse().map((s) => (
                <span
                  key={s.bg}
                  className="w-5 h-3 rounded-sm"
                  style={{ backgroundColor: s.bg }}
                  aria-hidden="true"
                />
              ))}
              <span className="text-[11px] text-[#8A6B4D]">Forte</span>
            </div>
            <p className="text-[11px] text-[#8A6B4D] max-w-xl">
              <strong>—</strong> = cohorte trop jeune pour cet horizon, pas un
              échec. Mesuré sur la dernière visite : un membre compte comme
              présent à J+7 si son dernier passage est au moins 7 jours après son
              inscription. La courbe sous-estime donc toujours, jamais l&apos;inverse.
            </p>
          </div>
        </>
      )}
    </Card>
  );
}
