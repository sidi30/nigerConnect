import { IconShield, IconCheck } from "./Icons";

const pillars = [
  "Authentification Google / Apple / Email",
  "JWT RS256 avec refresh rotatif — sessions robustes",
  "Mots de passe Argon2id — standard de l'industrie",
  "Vérification d'identité optionnelle pour les comptes associatifs",
  "Blocage, signalement & modération humaine",
  "Chiffrement AES-256 des données sensibles",
];

export function Security() {
  return (
    <section className="bg-brand-cream py-20 md:py-28">
      <div className="container-x grid items-center gap-14 md:grid-cols-2">
        <div className="relative">
          <div className="absolute -inset-6 rounded-[40px] bg-gradient-to-tr from-brand-orange/10 to-brand-green/10 blur-2xl" />
          <div className="relative rounded-3xl border border-tan-200 bg-white p-8 shadow-card">
            <div className="inline-flex rounded-2xl bg-brand-greenSoft p-3 text-brand-greenDark">
              <IconShield className="h-7 w-7" />
            </div>
            <h3 className="mt-5 font-serif text-2xl font-bold text-brand-brown">
              Une sécurité pensée dès le départ
            </h3>
            <p className="mt-2 text-sm text-tan-600">
              TLS 1.3, limitation des tentatives, liste blanche CORS, requêtes SQL
              paramétrées (anti-injection), détection de réutilisation des jetons de session
              et verrouillage automatique du compte après échecs répétés.
            </p>
            <div className="mt-6 h-px bg-tan-200" />
            <ul className="mt-6 space-y-3">
              {pillars.map((p) => (
                <li key={p} className="flex items-start gap-3 text-sm text-brand-brown">
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-greenSoft text-brand-greenDark">
                    <IconCheck className="h-3.5 w-3.5" />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          <span className="chip">Sécurité & confiance</span>
          <h2 className="section-title mt-4">
            Ta vie privée,
            <br />
            <span className="text-brand-greenDark">notre responsabilité.</span>
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-tan-600">
            NigerConnect n'est pas un réseau publicitaire. Pas de revente de données, pas de
            tracking tiers. Ton profil, tes messages et tes photos t'appartiennent — tu peux
            tout exporter ou supprimer à tout moment.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4">
            <KPI n="0" label="Publicité tierce" />
            <KPI n="AES-256" label="Données sensibles" />
            <KPI n="RGPD" label="Conforme UE" />
            <KPI n="<24h" label="Signalements traités" />
          </div>
        </div>
      </div>
    </section>
  );
}

function KPI({ n, label }: { n: string; label: string }) {
  return (
    <div className="rounded-2xl border border-tan-200 bg-white/60 px-4 py-3 backdrop-blur">
      <p className="font-serif text-2xl font-bold text-brand-orange">{n}</p>
      <p className="text-xs text-tan-600">{label}</p>
    </div>
  );
}
