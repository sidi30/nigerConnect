import { ScrollReveal } from "./ScrollReveal";

const cities = [
  { flag: "🇳🇪", city: "Niamey", country: "Niger", members: "2 400+" },
  { flag: "🇫🇷", city: "Paris", country: "France", members: "5 800+" },
  { flag: "🇫🇷", city: "Lyon", country: "France", members: "1 200+" },
  { flag: "🇨🇦", city: "Montréal", country: "Canada", members: "3 100+" },
  { flag: "🇺🇸", city: "New York", country: "États-Unis", members: "1 600+" },
  { flag: "🇹🇷", city: "Istanbul", country: "Turquie", members: "900+" },
  { flag: "🇲🇦", city: "Casablanca", country: "Maroc", members: "1 100+" },
  { flag: "🇸🇳", city: "Dakar", country: "Sénégal", members: "780+" },
  { flag: "🇧🇪", city: "Bruxelles", country: "Belgique", members: "540+" },
  { flag: "🇦🇪", city: "Dubaï", country: "Émirats", members: "620+" },
];

const moments = [
  { src: "/images/community-sahel.jpg", caption: "Fières de nos couleurs", wide: true },
  { src: "/images/niamey-market.jpg", caption: "Niamey, golden hour", wide: false },
  { src: "/images/community-cafe.jpg", caption: "Retrouvailles à Paris", wide: true },
  { src: "/images/portrait-1.jpg", caption: "Chacune a sa place", wide: false },
  { src: "/images/community-family.jpg", caption: "La famille s'agrandit", wide: true },
  { src: "/images/community-friends.jpg", caption: "On se comprend à demi-mot", wide: true },
];

export function Community() {
  return (
    <section id="community" className="relative overflow-hidden bg-gradient-dark py-20 text-white md:py-28">
      {/* Carte du monde vivante : les foyers de la diaspora scintillent en fond */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="kenburns absolute inset-0 bg-cover bg-center opacity-40"
          style={{ backgroundImage: "url(/images/world-connections.jpg)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-brand-brown/70 via-transparent to-brand-brown/80" />
      </div>

      <div className="container-x relative">
        <div className="grid items-end gap-10 md:grid-cols-2">
          <ScrollReveal variant="left">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white/80 backdrop-blur">
              <span className="inline-block h-2 w-2 rounded-full bg-brand-green" /> Une communauté mondiale
            </span>
            <h2 className="mt-4 font-serif text-4xl font-bold tracking-tight sm:text-5xl">
              Des Nigériens partout,
              <br />
              <span className="bg-gradient-orange bg-clip-text text-transparent">
                réunis ici.
              </span>
            </h2>
          </ScrollReveal>
          <ScrollReveal variant="right">
            <p className="text-lg leading-relaxed text-white/70">
              De Niamey à New York, de Dakar à Dubaï — NigerConnect donne une seule adresse à
              une diaspora qui s'entraide, s'informe et se célèbre depuis trop longtemps
              dispersée.
            </p>
          </ScrollReveal>
        </div>

        <ScrollReveal
          variant="stagger"
          className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        >
          {cities.map((c) => (
            <div
              key={c.city}
              className="group rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur transition hover:border-brand-orange hover:bg-white/10"
            >
              <div className="text-2xl">{c.flag}</div>
              <p className="mt-2 text-sm font-semibold">{c.city}</p>
              <p className="text-xs text-white/60">{c.country}</p>
              <p className="mt-2 text-xs font-semibold text-brand-orangeLight">
                {c.members} membres
              </p>
            </div>
          ))}
        </ScrollReveal>
      </div>

      {/* Des visages, pas des statistiques : la communauté défile, en vrai */}
      <ScrollReveal variant="up" className="relative mt-16">
        <div className="marquee" aria-label="Moments de la communauté">
          <div className="marquee-track gap-4 pr-4">
            {[...moments, ...moments].map((m, i) => (
              <figure
                key={i}
                aria-hidden={i >= moments.length}
                className="group relative h-52 shrink-0 overflow-hidden rounded-3xl border border-white/10"
              >
                <img
                  src={m.src}
                  alt={i < moments.length ? m.caption : ""}
                  width={m.wide ? 371 : 208}
                  height={208}
                  loading="lazy"
                  className={`h-full object-cover transition-transform duration-700 group-hover:scale-105 ${
                    m.wide ? "w-[371px]" : "w-52"
                  }`}
                />
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-brown/80 to-transparent p-3">
                  <p className="text-xs font-semibold text-white">{m.caption}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}
