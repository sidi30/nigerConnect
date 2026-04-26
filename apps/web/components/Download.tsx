import { IconApple, IconGooglePlay, IconArrowRight } from "./Icons";

export function Download() {
  return (
    <section id="download" className="relative overflow-hidden bg-gradient-dark py-24 text-white md:py-32">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-brand-orange/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-brand-green/15 blur-3xl" />

      <div className="container-x relative text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-medium text-white/80 backdrop-blur">
          🇳🇪 Rejoins la communauté
        </span>
        <h2 className="mx-auto mt-5 max-w-3xl font-serif text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl">
          Ta communauté t'attend.
          <br />
          <span className="bg-gradient-orange bg-clip-text text-transparent">
            Télécharge NigerConnect.
          </span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-lg text-white/70">
          Gratuit pour toujours. iOS 14+, Android 8+. Compte créé en 60 secondes.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href="#"
            className="group inline-flex items-center gap-3 rounded-full bg-white px-6 py-4 text-brand-brown shadow-lg transition hover:scale-[1.02]"
          >
            <IconApple className="h-8 w-8" />
            <div className="text-left">
              <p className="text-[10px] uppercase tracking-wider text-tan-500">Télécharger sur</p>
              <p className="-mt-0.5 font-serif text-lg font-bold">App Store</p>
            </div>
            <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
          <a
            href="#"
            className="group inline-flex items-center gap-3 rounded-full bg-white px-6 py-4 text-brand-brown shadow-lg transition hover:scale-[1.02]"
          >
            <IconGooglePlay className="h-8 w-8 text-brand-orange" />
            <div className="text-left">
              <p className="text-[10px] uppercase tracking-wider text-tan-500">Disponible sur</p>
              <p className="-mt-0.5 font-serif text-lg font-bold">Google Play</p>
            </div>
            <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
        </div>

        {/* Email waitlist */}
        <form className="mx-auto mt-10 flex max-w-md flex-col gap-2 sm:flex-row">
          <input
            type="email"
            required
            placeholder="ton@email.com"
            className="flex-1 rounded-full border border-white/15 bg-white/10 px-5 py-3.5 text-sm text-white placeholder-white/40 outline-none transition focus:border-brand-orange focus:bg-white/15"
          />
          <button type="submit" className="btn-primary">
            M'avertir du lancement
          </button>
        </form>
        <p className="mt-3 text-xs text-white/50">
          Pas de spam. Tu recevras un seul email : celui du lancement.
        </p>
      </div>
    </section>
  );
}
