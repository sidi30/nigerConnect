const steps = [
  {
    num: "01",
    title: "Télécharge & inscris-toi",
    body: "App Store ou Google Play. Inscription en 60 secondes avec Google, Apple ou email.",
  },
  {
    num: "02",
    title: "Ajoute ta ville",
    body: "Partage ta ville pour apparaître sur la Snap Map et retrouver les Nigériens près de toi.",
  },
  {
    num: "03",
    title: "Connecte-toi à la communauté",
    body: "Ajoute tes amis, rejoins des associations vérifiées, commence à poster et à discuter.",
  },
  {
    num: "04",
    title: "Vis ta culture, partout",
    body: "Échange, entraide, organise, partage — garde un lien fort avec le Niger et la diaspora.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="bg-brand-cream py-20 md:py-28">
      <div className="container-x">
        <div className="mx-auto max-w-2xl text-center">
          <span className="chip">Comment ça marche</span>
          <h2 className="section-title mt-4">Quatre étapes, c'est tout.</h2>
          <p className="mt-5 text-lg text-tan-600">
            Aucune courbe d'apprentissage. Si tu sais utiliser WhatsApp, tu sauras utiliser
            NigerConnect.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div
              key={i}
              className="relative rounded-3xl border border-tan-200 bg-white p-6 transition hover:border-brand-orange hover:shadow-card"
            >
              <div className="font-serif text-5xl font-bold text-brand-orange/20">{s.num}</div>
              <h3 className="mt-2 font-serif text-lg font-bold text-brand-brown">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-tan-600">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
