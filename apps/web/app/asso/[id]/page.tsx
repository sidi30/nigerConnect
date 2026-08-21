"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  listMyAssociations,
  isOfficer,
  roleLabel,
  AssoApiError,
  type MyAssociation,
} from "@/lib/assoApi";

// Dashboard of ONE association. The membership list is the authorization
// source the browser can see: /associations/mine only ever returns
// associations you actually belong to, with your real role in each. Anything
// missing from it, or held with a `member` role, is refused here.
//
// That refusal is a courtesy, not a defence — it spares an ex-officer a screen
// full of buttons that would all fail. The real gate is server-side, on every
// single action (assertRole).
export default function AssoDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [association, setAssociation] = useState<MyAssociation | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listMyAssociations(controller.signal)
      .then((mine) => {
        const found = mine.find((a) => a.id === id);
        if (!found || !isOfficer(found.role)) {
          setState("forbidden");
          return;
        }
        setAssociation(found);
        setState("ready");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof AssoApiError ? err.message : "Chargement impossible.");
        setState("error");
      });
    return () => controller.abort();
  }, [id]);

  if (state === "loading") {
    return <Centered>Chargement…</Centered>;
  }

  if (state === "error") {
    return (
      <Centered>
        <span role="alert" className="text-[#8B1F1F]">
          {error}
        </span>
      </Centered>
    );
  }

  if (state === "forbidden" || !association) {
    return (
      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white border border-[#E8DFD3] rounded-2xl p-8 text-center">
          <p className="font-semibold">Cette association n&apos;est pas administrable par toi</p>
          <p className="text-sm text-[#5A4634] mt-2">
            Soit tu n&apos;en fais pas partie, soit tu en es membre sans être administrateur.
          </p>
          <Link href="/asso" className="inline-block mt-6 text-[#E05206] font-semibold hover:underline">
            Revenir à mes associations
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <Link href="/asso" className="text-sm text-[#5A4634] hover:underline">
        ← Mes associations
      </Link>

      <header className="flex items-center gap-4 mt-4 mb-8">
        {association.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote CDN host, no loader configured
          <img
            src={association.logoUrl}
            alt=""
            className="w-16 h-16 rounded-2xl object-cover bg-[#E8DFD3] shrink-0"
          />
        ) : (
          <span className="w-16 h-16 rounded-2xl bg-[#E8DFD3] text-[#5A4634] text-xl font-bold flex items-center justify-center shrink-0">
            {association.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold truncate">{association.name}</h1>
          <p className="text-sm text-[#5A4634]">
            {roleLabel(association.role)} · {association.memberCount} membre
            {association.memberCount > 1 ? "s" : ""}
            {association.city ? ` · ${association.city}` : ""}
          </p>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card
          title="Membres et demandes"
          body="Approuver les demandes d'adhésion, gérer les rôles et le bureau."
          href={`/asso/${association.id}/membres`}
        />
        <Card
          title="Publications"
          body="Écrire une publication avec des images, depuis un vrai clavier."
          soon
        />
        <Card
          title="Événements"
          body="Annoncer une assemblée, une fête, une collecte."
          soon
        />
        <Card
          title="Espace de stockage"
          body="Suivre le volume occupé par les médias de l'association."
          soon
        />
      </section>
    </main>
  );
}

function Card({
  title,
  body,
  soon,
  href,
}: {
  title: string;
  body: string;
  soon?: boolean;
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {soon ? (
          <span className="text-xs text-[#5A4634] bg-[#F7F2EA] border border-[#E8DFD3] rounded-full px-2 py-0.5 shrink-0">
            bientôt
          </span>
        ) : null}
      </div>
      <p className="text-sm text-[#5A4634] mt-2">{body}</p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="bg-white border border-[#E8DFD3] rounded-2xl p-5 block hover:border-[#E05206] transition-colors"
      >
        {inner}
      </Link>
    );
  }

  return <div className="bg-white border border-[#E8DFD3] rounded-2xl p-5">{inner}</div>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[60vh] flex items-center justify-center">
      <p className="text-[#5A4634] text-sm">{children}</p>
    </main>
  );
}
