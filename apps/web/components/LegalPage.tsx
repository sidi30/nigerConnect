import Link from "next/link";

export interface LegalSection {
  heading?: string;
  body?: string;
  bullets?: string[];
}

interface Props {
  title: string;
  lastUpdated: string;
  intro: string;
  sections: LegalSection[];
  contact?: string;
}

/**
 * Public mirror of the mobile `LegalDoc` component. Google Play and Apple
 * App Store both require these texts to be reachable on a public URL — not
 * just in the app — and the URLs must stay live for the lifetime of the
 * listing. Keeping a dedicated, indexable web page per legal doc is the
 * simplest way to satisfy both stores.
 */
export function LegalPage({ title, lastUpdated, intro, sections, contact }: Props) {
  return (
    <main className="min-h-screen bg-[#FDFBF7] py-12 px-6">
      <article className="max-w-3xl mx-auto bg-white border border-[#E8DFD3] rounded-2xl shadow-sm p-8 md:p-12">
        <Link href="/" className="text-[#E05206] font-semibold hover:underline text-sm">
          ← NigerConnect
        </Link>
        <h1 className="text-3xl md:text-4xl font-extrabold text-[#1A0F0A] mt-4 mb-2">
          {title}
        </h1>
        <p className="text-sm text-[#8A6B4D] font-semibold mb-6">Mis à jour le {lastUpdated}</p>
        <p className="text-base text-[#1A0F0A] leading-relaxed mb-8">{intro}</p>

        {sections.map((s, i) => (
          <section key={i} className="mb-7">
            {s.heading ? (
              <h2 className="text-lg font-extrabold text-[#1A0F0A] mb-2">{s.heading}</h2>
            ) : null}
            {s.body ? (
              <p className="text-[15px] text-[#5A4634] leading-relaxed mb-2 whitespace-pre-line">
                {s.body}
              </p>
            ) : null}
            {s.bullets?.length ? (
              <ul className="space-y-1 mt-2">
                {s.bullets.map((b, j) => (
                  <li
                    key={j}
                    className="flex gap-2 text-[15px] text-[#5A4634] leading-relaxed"
                  >
                    <span className="text-[#E05206] font-bold">•</span>
                    <span className="flex-1">{b}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        {contact ? (
          <aside className="bg-[#FDFBF7] border border-[#E8DFD3] rounded-lg p-4 mt-8">
            <h3 className="text-sm font-extrabold text-[#1A0F0A] mb-1">Nous contacter</h3>
            <p className="text-sm text-[#5A4634] leading-relaxed">{contact}</p>
          </aside>
        ) : null}
      </article>
    </main>
  );
}
