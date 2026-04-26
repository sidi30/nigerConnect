export function Context() {
  return (
    <section className="bg-brand-cream py-20 md:py-28">
      <div className="container-x grid gap-12 md:grid-cols-12 md:gap-16">
        <div className="md:col-span-5">
          <span className="chip">Le problème</span>
          <h2 className="section-title mt-4">
            Une diaspora riche,
            <br />
            mais <em className="not-italic text-brand-orange">dispersée</em>.
          </h2>
        </div>
        <div className="md:col-span-7">
          <p className="text-lg leading-relaxed text-tan-600">
            Des milliers de Nigériens vivent loin du pays — étudiants à Montréal, ingénieurs à
            Paris, commerçantes à Istanbul, familles à Dubaï. Mais les outils existants
            (Facebook, WhatsApp, groupes dispersés) ne sont pas faits pour{" "}
            <strong className="text-brand-brown">
              une communauté qui partage une langue, une culture et des besoins communs
            </strong>
            .
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Pain
              emoji="🔍"
              title="Difficile de se retrouver"
              body="Pas de moyen simple de voir qui est Nigérien autour de toi dans une nouvelle ville."
            />
            <Pain
              emoji="🤝"
              title="Entraide éparpillée"
              body="Les demandes d'aide se perdent dans des groupes WhatsApp saturés."
            />
            <Pain
              emoji="📰"
              title="Infos fragmentées"
              body="Associations, événements culturels, opportunités : tout est dispersé."
            />
            <Pain
              emoji="💬"
              title="Pas d'espace dédié"
              body="Les réseaux généralistes noient la culture et les codes nigériens."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Pain({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-tan-200 bg-white/60 p-5 backdrop-blur transition hover:border-brand-orange hover:shadow-soft">
      <div className="text-2xl">{emoji}</div>
      <p className="mt-2 font-semibold text-brand-brown">{title}</p>
      <p className="mt-1 text-sm leading-relaxed text-tan-600">{body}</p>
    </div>
  );
}
