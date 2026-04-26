import {
  IconMap,
  IconFeed,
  IconChat,
  IconHandshake,
  IconUsers,
  IconBell,
} from "./Icons";
import type { ComponentType, SVGProps } from "react";

type Feature = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
  tint: string;
  iconColor: string;
};

const features: Feature[] = [
  {
    icon: IconMap,
    title: "Snap Map communautaire",
    body: "Visualise en un coup d'œil les Nigériens autour de toi. Clusters par zoom, villes, pays — découvre ta communauté locale.",
    tint: "from-brand-orange/10 to-brand-orange/5",
    iconColor: "text-brand-orange",
  },
  {
    icon: IconFeed,
    title: "Feed & Stories 24h",
    body: "Posts, photos, stories éphémères. Partage ton quotidien, ton business, tes événements avec la communauté.",
    tint: "from-brand-green/10 to-brand-green/5",
    iconColor: "text-brand-greenDark",
  },
  {
    icon: IconChat,
    title: "Chat temps réel",
    body: "Messages privés, groupes, indicateurs de présence et de frappe. Socket.io natif — instant, fluide, fiable.",
    tint: "from-amber-200/40 to-amber-100/20",
    iconColor: "text-amber-700",
  },
  {
    icon: IconHandshake,
    title: "Marketplace d'entraide",
    body: "Offre ou demande un service : traduction, hébergement, cours, covoiturage. Système d'évaluation intégré.",
    tint: "from-brand-orange/10 to-peach-50",
    iconColor: "text-brand-orange",
  },
  {
    icon: IconUsers,
    title: "Associations vérifiées",
    body: "Rejoins les associations nigériennes officielles de ta ville. Événements, réunions, projets collectifs.",
    tint: "from-purple-100 to-purple-50",
    iconColor: "text-purple-700",
  },
  {
    icon: IconBell,
    title: "Notifications intelligentes",
    body: "Groupées, non spammantes. Push, email, SMS selon ta préférence. Tu gardes le contrôle total.",
    tint: "from-tan-100 to-tan-50",
    iconColor: "text-tan-600",
  },
];

export function Features() {
  return (
    <section id="features" className="bg-gradient-warm py-20 md:py-28">
      <div className="container-x">
        <div className="mx-auto max-w-2xl text-center">
          <span className="chip">Fonctionnalités</span>
          <h2 className="section-title mt-4">
            Tout ce dont la diaspora a besoin,
            <br />
            <span className="bg-gradient-orange bg-clip-text text-transparent">
              dans une seule app.
            </span>
          </h2>
          <p className="mt-5 text-lg text-tan-600">
            Pensé pour les Nigériens, par des Nigériens. Chaque fonctionnalité répond à un
            besoin réel exprimé par la communauté.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={i}
                className="group relative overflow-hidden rounded-3xl border border-tan-200 bg-white p-6 transition hover:-translate-y-1 hover:border-brand-orange/40 hover:shadow-card"
              >
                <div
                  className={`absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br ${f.tint} opacity-80 transition-opacity group-hover:opacity-100`}
                />
                <div className={`relative inline-flex rounded-2xl bg-brand-cream p-3 ${f.iconColor}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="relative mt-5 font-serif text-xl font-bold text-brand-brown">
                  {f.title}
                </h3>
                <p className="relative mt-2 text-sm leading-relaxed text-tan-600">{f.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
