import { ScrollReveal } from "./ScrollReveal";

/* Panneaux du quadriptyque public/images/diaspora-quad.jpg (4 colonnes égales),
   découpés en CSS via background-position — une seule requête image. */
const places = [
  { x: "0%", city: "Paris", role: "Étudiants & diplômés", flag: "🇫🇷" },
  { x: "33.34%", city: "Montréal", role: "Ingénieurs & familles", flag: "🇨🇦" },
  { x: "66.67%", city: "Dubaï", role: "Commerçantes & business", flag: "🇦🇪" },
  { x: "100%", city: "Niamey", role: "Le pays, toujours là", flag: "🇳🇪" },
];

export function Context() {
  return (
    <section className="bg-brand-cream py-20 md:py-28">
      <div className="container-x">
        <div className="grid gap-12 md:grid-cols-12 md:gap-16">
          <ScrollReveal variant="left" className="md:col-span-5">
            <span className="chip">Le problème</span>
            <h2 className="section-title mt-4">
              Une diaspora riche,
              <br />
              mais <em className="not-italic text-brand-orange">dispersée</em>.
            </h2>
          </ScrollReveal>
          <ScrollReveal variant="right" className="md:col-span-7">
            <p className="text-lg leading-relaxed text-tan-600">
              Des milliers de Nigériens vivent loin du pays — étudiants à Montréal, ingénieurs à
              Paris, commerçantes à Istanbul, familles à Dubaï. Mais les outils existants
              (Facebook, WhatsApp, groupes dispersés) ne sont pas faits pour{" "}
              <strong className="text-brand-brown">
                une communauté qui partage une langue, une culture et des besoins communs
              </strong>
              .
            </p>
          </ScrollReveal>
        </div>

        {/* Même heure, quatre fuseaux : le geste est le même, la communauté est coupée. */}
        <ScrollReveal variant="stagger" className="mt-12 hidden h-96 gap-3 sm:flex">
          {places.map((p) => (
            <PlaceTile key={p.city} place={p} className="flex-1 hover:flex-[1.9]" />
          ))}
        </ScrollReveal>
        <ScrollReveal variant="stagger" className="mt-10 grid grid-cols-2 gap-3 sm:hidden">
          {places.map((p) => (
            <PlaceTile key={p.city} place={p} className="aspect-[3/4]" />
          ))}
        </ScrollReveal>
        <ScrollReveal variant="up" delay={200}>
          <p className="mt-4 text-center text-sm italic text-tan-500">
            Quatre villes, un même réflexe — mais chacun scrolle seul.{" "}
            <span className="font-semibold not-italic text-brand-orange">
              Jusqu'à maintenant.
            </span>
          </p>
        </ScrollReveal>

        <ScrollReveal variant="stagger" className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        </ScrollReveal>
      </div>
    </section>
  );
}

function PlaceTile({
  place,
  className,
}: {
  place: (typeof places)[number];
  className: string;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-3xl shadow-card transition-all duration-500 ease-out ${className}`}
    >
      <div
        className="absolute inset-0 transition-transform duration-700 group-hover:scale-105"
        style={{
          backgroundImage: "url(/images/diaspora-quad.jpg)",
          backgroundSize: "400% auto",
          backgroundPosition: `${place.x} 25%`,
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-brand-brown/80 via-brand-brown/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p className="font-serif text-lg font-bold text-white">
          {place.flag} {place.city}
        </p>
        <p className="text-xs text-white/75">{place.role}</p>
      </div>
    </div>
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
