import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Aide & contact",
  description:
    "Besoin d'aide avec NigerConnect ? Contacte l'équipe, signale un problème, demande l'export ou la suppression de tes données.",
  alternates: { canonical: "/support" },
};

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Comment supprimer mon compte ?",
    a: "Depuis l'app : Profil → Paramètres → Supprimer mon compte. Sans l'app : utilise la page /account-deletion. La suppression est immédiate et toutes les données sont effacées.",
  },
  {
    q: "Comment exporter mes données (RGPD article 20) ?",
    a: "Écris à contact@nigerconnect.app depuis l'adresse de ton compte. Tu reçois un export JSON complet sous 30 jours conformément au RGPD.",
  },
  {
    q: "Mon compte a été suspendu, que faire ?",
    a: "Écris à contact@nigerconnect.app en précisant l'email du compte. L'équipe modération répond sous 72 h ouvrées.",
  },
  {
    q: "Je n'ai pas reçu l'email de vérification",
    a: "Vérifie tes spams. Si toujours rien, demande un nouveau lien depuis l'app (Paramètres → Vérifier mon email) ou écris à contact@nigerconnect.app.",
  },
  {
    q: "Je veux signaler un contenu",
    a: "Touche le bouton ⋯ ou 🚩 sur la publication / le profil concerné depuis l'app. Pour une urgence (mineur en danger, menace physique), écris directement à contact@nigerconnect.app.",
  },
  {
    q: "Comment se faire vérifier (badge ✓) ?",
    a: "Profil → Paramètres → Vérification d'identité. Charge un document officiel (carte d'identité, passeport). Notre équipe valide sous 5 jours ouvrés. Le document est chiffré et supprimé 30 jours après validation.",
  },
];

const CONTACTS: Array<{ icon: string; label: string; email: string; desc: string }> = [
  {
    icon: "💬",
    label: "Support général",
    email: "contact@nigerconnect.app",
    desc: "Question, bug, suggestion — réponse sous 5 jours ouvrés.",
  },
  {
    icon: "🔒",
    label: "Confidentialité / RGPD",
    email: "contact@nigerconnect.app",
    desc: "Export, rectification, suppression de données, questions RGPD.",
  },
  {
    icon: "🚨",
    label: "Sécurité",
    email: "contact@nigerconnect.app",
    desc: "Urgence sécurité utilisateur, mineur en danger, menace physique.",
  },
  {
    icon: "⚖️",
    label: "Légal",
    email: "contact@nigerconnect.app",
    desc: "Réquisition judiciaire, droits d'auteur, demande légale.",
  },
  {
    icon: "📨",
    label: "Modération — appel",
    email: "contact@nigerconnect.app",
    desc: "Contester une suspension ou une décision de modération.",
  },
];

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-[#FDFBF7] py-12 px-6">
      <article className="max-w-3xl mx-auto">
        <Link href="/" className="text-[#E05206] font-semibold hover:underline text-sm">
          ← NigerConnect
        </Link>
        <h1 className="text-3xl md:text-4xl font-extrabold text-[#1A0F0A] mt-4 mb-2">
          Aide &amp; contact
        </h1>
        <p className="text-[#5A4634] leading-relaxed mb-10">
          On t&apos;aide à utiliser NigerConnect. Réponses aux questions fréquentes,
          adresses email dédiées, accès direct à la suppression de compte.
        </p>

        <section className="mb-12">
          <h2 className="text-xl font-extrabold text-[#1A0F0A] mb-4">Questions fréquentes</h2>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <details
                key={i}
                className="bg-white border border-[#E8DFD3] rounded-xl px-5 py-4 group"
              >
                <summary className="font-semibold text-[#1A0F0A] cursor-pointer list-none flex items-center justify-between">
                  <span>{item.q}</span>
                  <span className="text-[#E05206] group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <p className="text-[15px] text-[#5A4634] leading-relaxed mt-3">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-extrabold text-[#1A0F0A] mb-4">Nous écrire</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {CONTACTS.map((c) => (
              <a
                key={c.email}
                href={`mailto:${c.email}`}
                className="bg-white border border-[#E8DFD3] rounded-xl p-5 hover:border-[#E05206] hover:shadow-sm transition-all block"
              >
                <div className="text-2xl mb-2">{c.icon}</div>
                <h3 className="font-bold text-[#1A0F0A]">{c.label}</h3>
                <p className="text-[#E05206] font-medium text-sm mt-1 break-all">{c.email}</p>
                <p className="text-[13px] text-[#8A6B4D] leading-relaxed mt-2">{c.desc}</p>
              </a>
            ))}
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-3">
          <Link
            href="/privacy"
            className="bg-white border border-[#E8DFD3] rounded-xl p-4 hover:border-[#E05206] transition text-center"
          >
            <div className="text-2xl mb-1">🔐</div>
            <span className="font-semibold text-[#1A0F0A] text-sm">Confidentialité</span>
          </Link>
          <Link
            href="/terms"
            className="bg-white border border-[#E8DFD3] rounded-xl p-4 hover:border-[#E05206] transition text-center"
          >
            <div className="text-2xl mb-1">📜</div>
            <span className="font-semibold text-[#1A0F0A] text-sm">Conditions</span>
          </Link>
          <Link
            href="/account-deletion"
            className="bg-white border border-[#E8DFD3] rounded-xl p-4 hover:border-[#C0392B] transition text-center"
          >
            <div className="text-2xl mb-1">🗑️</div>
            <span className="font-semibold text-[#1A0F0A] text-sm">Supprimer mon compte</span>
          </Link>
        </section>
      </article>
    </main>
  );
}
