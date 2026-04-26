import { PhoneMockup } from "./PhoneMockup";
import { IconApple, IconGooglePlay, IconArrowRight } from "./Icons";

export function Hero() {
  return (
    <section className="grain relative overflow-hidden bg-gradient-warm pt-12 pb-20 md:pt-20 md:pb-28">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-brand-orange/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-brand-green/10 blur-3xl" />

      <div className="container-x relative grid items-center gap-12 md:grid-cols-2 md:gap-10">
        <div className="reveal">
          <span className="chip">
            <span className="inline-block h-2 w-2 rounded-full bg-brand-green animate-pulse" />
            Disponible bientôt · iOS & Android
          </span>

          <h1 className="mt-6 font-serif text-5xl font-bold leading-[1.05] tracking-tight text-brand-brown sm:text-6xl md:text-[68px]">
            Se retrouver.
            <br />
            <span className="bg-gradient-orange bg-clip-text text-transparent">
              S'entraider.
            </span>
            <br />
            Rester connectés.
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-tan-600">
            NigerConnect rassemble la diaspora nigérienne —{" "}
            <strong className="text-brand-brown">62 000+ personnes dans 15+ pays</strong>.
            Un réseau pensé pour retrouver tes proches, trouver de l'aide, vivre ta culture,
            où que tu sois dans le monde.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="#download" className="btn-primary group">
              <IconApple className="h-5 w-5" />
              Télécharger sur iOS
              <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a href="#download" className="btn-ghost group">
              <IconGooglePlay className="h-5 w-5 text-brand-orange" />
              Google Play
            </a>
          </div>

          <div className="mt-10 grid grid-cols-3 gap-4 border-t border-tan-200 pt-6">
            <Stat value="62K+" label="Nigériens diaspora" />
            <Stat value="15+" label="Pays couverts" />
            <Stat value="100%" label="Gratuit" />
          </div>
        </div>

        <div className="reveal" style={{ animationDelay: "0.15s" }}>
          <PhoneMockup />
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-serif text-3xl font-bold text-brand-brown">{value}</p>
      <p className="mt-0.5 text-xs text-tan-500">{label}</p>
    </div>
  );
}
