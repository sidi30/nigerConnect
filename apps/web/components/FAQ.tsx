const faqs = [
  {
    q: "L'application est-elle gratuite ?",
    a: "Oui, à 100 %. Pas d'abonnement, pas de publicité intrusive, pas de paywall. NigerConnect est financée par la communauté et des partenariats éthiques avec des associations nigériennes.",
  },
  {
    q: "Qui peut s'inscrire ?",
    a: "Tout Nigérien ou Nigérienne, au Niger ou dans la diaspora, ainsi que toute personne proche de la communauté (conjoints, amis, partenaires d'associations). La vérification d'identité est optionnelle mais recommandée pour les membres actifs.",
  },
  {
    q: "Mes données sont-elles vendues à des tiers ?",
    a: "Jamais. Nous ne vendons, ne louons et ne partageons pas tes données avec des annonceurs. Tu peux exporter ou supprimer ton compte à tout moment en un clic.",
  },
  {
    q: "Puis-je rester anonyme sur la carte ?",
    a: "Oui. Tu contrôles entièrement ta visibilité : ville précise, ville approximative, pays seulement, ou totalement invisible. Tu peux changer à tout moment.",
  },
  {
    q: "Quand sort l'application ?",
    a: "La version v1.0 est finalisée. Beta publique iOS + Android prévue dans les prochaines semaines. Inscris-toi ci-dessous pour être notifié·e en priorité.",
  },
  {
    q: "Y aura-t-il une version web ?",
    a: "Oui, une version web complémentaire est prévue pour consulter ton feed, tes messages et la carte depuis ton ordinateur. L'app mobile reste le produit principal.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="bg-gradient-warm py-20 md:py-28">
      <div className="container-x">
        <div className="mx-auto max-w-2xl text-center">
          <span className="chip">Questions fréquentes</span>
          <h2 className="section-title mt-4">On répond à tout.</h2>
        </div>

        <div className="mx-auto mt-12 max-w-3xl divide-y divide-tan-200 rounded-3xl border border-tan-200 bg-white shadow-soft">
          {faqs.map((f, i) => (
            <details key={i} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <span className="font-serif text-lg font-semibold text-brand-brown">{f.q}</span>
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-cream text-brand-orange transition group-open:rotate-45">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-tan-600">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
