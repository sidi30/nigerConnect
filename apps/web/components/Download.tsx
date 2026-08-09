import { IconApple, IconGooglePlay, IconArrowRight } from "./Icons";
import { WaitlistForm } from "./WaitlistForm";
import { ScrollReveal } from "./ScrollReveal";
import { ANDROID_AVAILABLE, ANDROID_STORE_URL, IOS_STORE_URL } from "@/lib/stores";

const avatars = [
  "/images/avatar-5.jpg",
  "/images/avatar-4.jpg",
  "/images/avatar-1.jpg",
  "/images/avatar-3.jpg",
  "/images/avatar-2.jpg",
];

export function Download() {
  return (
    <section id="download" className="relative overflow-hidden bg-gradient-dark py-24 text-white md:py-32">
      <div className="pointer-events-none absolute -top-32 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-brand-orange/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-brand-green/15 blur-3xl" />

      <div className="container-x relative text-center">
        <ScrollReveal variant="zoom" className="mb-5 flex justify-center">
          <div className="flex -space-x-3">
            {avatars.map((src, i) => (
              <img
                key={src}
                src={src}
                alt=""
                width={44}
                height={44}
                loading="lazy"
                className="h-11 w-11 rounded-full border-2 border-white/80 object-cover"
                style={{ zIndex: avatars.length - i }}
              />
            ))}
          </div>
        </ScrollReveal>
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
          {ANDROID_AVAILABLE
            ? "Gratuit pour toujours. iOS 14+, Android 8+. Compte créé en 60 secondes."
            : "Gratuit pour toujours. Disponible sur iPhone — la version Android arrive. Compte créé en 60 secondes."}
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a
            href={IOS_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-3 rounded-full bg-white px-6 py-4 text-brand-brown shadow-lg transition hover:scale-[1.02]"
          >
            <IconApple className="h-8 w-8" />
            <div className="text-left">
              <p className="text-[10px] uppercase tracking-wider text-tan-500">Télécharger sur</p>
              <p className="-mt-0.5 font-serif text-lg font-bold">App Store</p>
            </div>
            <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
          {ANDROID_AVAILABLE ? (
            <a
              href={ANDROID_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-3 rounded-full bg-white px-6 py-4 text-brand-brown shadow-lg transition hover:scale-[1.02]"
            >
              <IconGooglePlay className="h-8 w-8 text-brand-orange" />
              <div className="text-left">
                <p className="text-[10px] uppercase tracking-wider text-tan-500">Disponible sur</p>
                <p className="-mt-0.5 font-serif text-lg font-bold">Google Play</p>
              </div>
              <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
          ) : (
            <a
              href="#waitlist"
              className="group inline-flex items-center gap-3 rounded-full border border-white/20 bg-white/5 px-6 py-4 text-white backdrop-blur transition hover:bg-white/10"
            >
              <IconGooglePlay className="h-8 w-8 text-white/70" />
              <div className="text-left">
                <p className="text-[10px] uppercase tracking-wider text-white/60">Android</p>
                <p className="-mt-0.5 font-serif text-lg font-bold">Préviens-moi au lancement</p>
              </div>
              <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
          )}
        </div>

        {/* Email waitlist / newsletter — also the landing target of the Android
            call-to-action while the Play Store listing is not live. */}
        <div id="waitlist" className="scroll-mt-24">
          <WaitlistForm />
        </div>
      </div>
    </section>
  );
}
