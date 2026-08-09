import { PhoneMockup } from "./PhoneMockup";
import { IconApple, IconGooglePlay, IconArrowRight } from "./Icons";

const avatars = [
  "/images/avatar-1.jpg",
  "/images/avatar-2.jpg",
  "/images/avatar-3.jpg",
  "/images/avatar-4.jpg",
  "/images/avatar-5.jpg",
];

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
            <strong className="text-brand-brown">Le Niger ne s'arrête pas aux frontières.</strong>{" "}
            NigerConnect réunit la diaspora nigérienne dispersée aux quatre coins du monde —
            du continent à l'Europe et au Golfe. Retrouve tes proches, trouve de l'aide et
            vis ta culture : où que tu sois, le pays n'est jamais loin.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href="#download" className="btn-primary group">
              Rejoindre l'aventure
              <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a href="#download" className="btn-ghost group">
              <IconApple className="h-5 w-5" />
              <IconGooglePlay className="h-5 w-5 text-brand-orange" />
              iOS &amp; Android
            </a>
          </div>

          {/* Preuve sociale : la communauté a déjà un visage */}
          <div className="mt-8 flex items-center gap-3">
            <div className="flex -space-x-3">
              {avatars.map((src, i) => (
                <img
                  key={src}
                  src={src}
                  alt=""
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-full border-2 border-white object-cover shadow-soft"
                  style={{ zIndex: avatars.length - i }}
                />
              ))}
            </div>
            <p className="text-sm leading-snug text-tan-600">
              <span className="font-semibold text-brand-brown">La communauté t'attend</span>
              <br />
              de Niamey à Montréal 🇳🇪
            </p>
          </div>

          <div className="mt-10 grid grid-cols-3 gap-4 border-t border-tan-200 pt-6">
            <Stat value="100%" label="Gratuit, pour toujours" />
            <Stat value="0" label="Pub & tracking tiers" />
            <Stat value="RGPD" label="Conforme UE" />
          </div>
        </div>

        <div className="reveal relative" style={{ animationDelay: "0.15s" }}>
          {/* Cartes photo flottantes : le pays d'un côté, la diaspora de l'autre */}
          <div className="pointer-events-none absolute -left-10 top-6 hidden w-44 rotate-[-5deg] animate-float-slow overflow-hidden rounded-2xl shadow-card lg:block">
            <img
              src="/images/niamey-market.jpg"
              alt="Au marché à Niamey"
              width={176}
              height={176}
              className="h-44 w-44 object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-brown/70 to-transparent p-2.5">
              <p className="text-[11px] font-semibold text-white">🇳🇪 Niamey, 18h04</p>
            </div>
          </div>
          <div
            className="pointer-events-none absolute -right-8 bottom-10 hidden w-52 rotate-[4deg] animate-float-slow overflow-hidden rounded-2xl shadow-card lg:block"
            style={{ animationDelay: "2s" }}
          >
            <img
              src="/images/community-sahel.jpg"
              alt="La communauté réunie"
              width={208}
              height={117}
              className="h-32 w-52 object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-brown/70 to-transparent p-2.5">
              <p className="text-[11px] font-semibold text-white">Ensemble, où qu'on soit</p>
            </div>
          </div>

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
