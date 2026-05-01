import Link from "next/link";
import { LogoMark } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-tan-200 bg-brand-cream">
      <div className="container-x py-14">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <LogoMark />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-tan-600">
              Le réseau social de la diaspora nigérienne. Se retrouver, s'entraider, rester
              connectés — où que tu sois dans le monde.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-tan-500">
              Produit
            </h4>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <a href="#features" className="text-brand-brown transition hover:text-brand-orange">
                  Fonctionnalités
                </a>
              </li>
              <li>
                <a href="#how" className="text-brand-brown transition hover:text-brand-orange">
                  Comment ça marche
                </a>
              </li>
              <li>
                <a href="#community" className="text-brand-brown transition hover:text-brand-orange">
                  Communauté
                </a>
              </li>
              <li>
                <a href="#download" className="text-brand-brown transition hover:text-brand-orange">
                  Télécharger
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-tan-500">
              Légal
            </h4>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li>
                <Link
                  href="/terms"
                  className="text-brand-brown transition hover:text-brand-orange"
                >
                  Conditions d&apos;utilisation
                </Link>
              </li>
              <li>
                <Link
                  href="/privacy"
                  className="text-brand-brown transition hover:text-brand-orange"
                >
                  Confidentialité
                </Link>
              </li>
              <li>
                <Link
                  href="/community"
                  className="text-brand-brown transition hover:text-brand-orange"
                >
                  Règles communautaires
                </Link>
              </li>
              <li>
                <Link
                  href="/account-deletion"
                  className="text-brand-brown transition hover:text-brand-orange"
                >
                  Supprimer mon compte
                </Link>
              </li>
              <li>
                <Link
                  href="/support"
                  className="text-brand-brown transition hover:text-brand-orange"
                >
                  Aide &amp; contact
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-tan-200 pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-tan-500">
            © {new Date().getFullYear()} NigerConnect. Fait avec ❤️ pour la diaspora 🇳🇪
          </p>
          <div className="flex items-center gap-4 text-tan-500">
            <a href="#" aria-label="Instagram" className="transition hover:text-brand-orange">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
              </svg>
            </a>
            <a href="#" aria-label="TikTok" className="transition hover:text-brand-orange">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M16.5 3a5.5 5.5 0 0 0 4.5 4.5v3a8.5 8.5 0 0 1-4.5-1.35V16a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V3h3Z" />
              </svg>
            </a>
            <a href="#" aria-label="X" className="transition hover:text-brand-orange">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M3 3h4.5l4.5 6 5-6H20l-7 8.4L21 21h-4.5l-5-6.5L5 21H3l7.5-9L3 3Z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
