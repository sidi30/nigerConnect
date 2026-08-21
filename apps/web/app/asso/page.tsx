"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  listMyAssociations,
  isOfficer,
  roleLabel,
  clearSession,
  AssoApiError,
  type MyAssociation,
} from "@/lib/assoApi";

// Association selector. A person can sit on the board of several associations
// (a hometown association AND a students' union is the ordinary case), so the
// back-office always starts by asking which one you are acting for — there is
// no implicit "current association" that a misclick could carry over.
//
// Associations where you are only a member are listed too, greyed out: seeing
// them explains why they are not administrable instead of leaving you to
// wonder whether the page failed to load.
export default function AssoSelectorPage() {
  const router = useRouter();
  const [associations, setAssociations] = useState<MyAssociation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listMyAssociations(controller.signal)
      .then(setAssociations)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof AssoApiError ? err.message : "Chargement impossible.");
      });
    return () => controller.abort();
  }, []);

  function logout() {
    clearSession();
    router.replace("/asso/login");
  }

  const officer = associations?.filter((a) => isOfficer(a.role)) ?? [];
  const plainMember = associations?.filter((a) => !isOfficer(a.role)) ?? [];

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      <header className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold">Mes associations</h1>
          <p className="text-sm text-[#5A4634] mt-1">
            Choisis l&apos;association pour laquelle tu agis.
          </p>
        </div>
        <button onClick={logout} className="text-sm text-[#5A4634] hover:underline shrink-0 mt-1">
          Se déconnecter
        </button>
      </header>

      {error ? (
        <div role="alert" className="bg-[#FCE8E8] border border-[#F5C2C2] text-[#8B1F1F] rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      ) : associations === null ? (
        <p className="text-[#5A4634] text-sm">Chargement…</p>
      ) : officer.length === 0 && plainMember.length === 0 ? (
        <EmptyState
          title="Tu n&apos;es membre d&apos;aucune association"
          body="Rejoins une association depuis l&apos;application mobile. Son bureau pourra ensuite te donner le rôle d&apos;administrateur."
        />
      ) : officer.length === 0 ? (
        <>
          <EmptyState
            title="Aucune association à administrer"
            body="Tu es membre, mais pas encore administrateur. C&apos;est un membre du bureau qui accorde ce rôle, depuis l&apos;application."
          />
          <MemberList associations={plainMember} />
        </>
      ) : (
        <>
          <ul className="space-y-3">
            {officer.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/asso/${a.id}`}
                  className="flex items-center gap-4 bg-white border border-[#E8DFD3] rounded-2xl p-4 hover:border-[#E05206] transition-colors"
                >
                  <Logo association={a} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold truncate">{a.name}</span>
                    <span className="block text-sm text-[#5A4634]">
                      {roleLabel(a.role)} · {a.memberCount} membre{a.memberCount > 1 ? "s" : ""}
                      {a.city ? ` · ${a.city}` : ""}
                    </span>
                  </span>
                  {a.isVerified ? <Certified /> : null}
                </Link>
              </li>
            ))}
          </ul>
          <MemberList associations={plainMember} />
        </>
      )}
    </main>
  );
}

function MemberList({ associations }: { associations: MyAssociation[] }) {
  if (associations.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold text-[#5A4634] mb-3">
        Associations où tu es simple membre
      </h2>
      <ul className="space-y-2">
        {associations.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-4 bg-[#F7F2EA] border border-[#E8DFD3] rounded-2xl p-4 opacity-70"
          >
            <Logo association={a} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold truncate">{a.name}</span>
              <span className="block text-sm text-[#5A4634]">Membre — pas d&apos;accès au back-office</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white border border-[#E8DFD3] rounded-2xl p-8 text-center">
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-[#5A4634] mt-2">{body}</p>
    </div>
  );
}

function Logo({ association }: { association: MyAssociation }) {
  if (association.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- remote CDN host, no loader configured
    return (
      <img
        src={association.logoUrl}
        alt=""
        className="w-12 h-12 rounded-xl object-cover shrink-0 bg-[#E8DFD3]"
      />
    );
  }
  return (
    <span className="w-12 h-12 rounded-xl bg-[#E8DFD3] text-[#5A4634] font-bold flex items-center justify-center shrink-0">
      {association.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Certified() {
  return (
    <span
      title="Association certifiée"
      className="shrink-0 text-xs font-semibold text-[#8A5A00] bg-[#FFF3D6] border border-[#F0DCA8] rounded-full px-3 py-1"
    >
      Certifiée
    </span>
  );
}
