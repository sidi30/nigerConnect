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

export function Community() {
  return (
    <section id="community" className="bg-gradient-dark py-20 text-white md:py-28">
      <div className="container-x">
        <div className="grid items-end gap-10 md:grid-cols-2">
          <div>
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
          </div>
          <p className="text-lg leading-relaxed text-white/70">
            De Niamey à New York, de Dakar à Dubaï — NigerConnect donne une seule adresse à
            une diaspora qui s'entraide, s'informe et se célèbre depuis trop longtemps
            dispersée.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
        </div>
      </div>
    </section>
  );
}
