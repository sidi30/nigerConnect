import Link from "next/link";
import { LogoMark } from "./Logo";

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-tan-200/60 bg-brand-cream/80 backdrop-blur-lg">
      <div className="container-x flex h-16 items-center justify-between">
        <Link href="/" aria-label="NigerConnect — Accueil">
          <LogoMark />
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          <a href="#features" className="text-sm font-medium text-tan-600 transition hover:text-brand-orange">
            Fonctionnalités
          </a>
          <a href="#how" className="text-sm font-medium text-tan-600 transition hover:text-brand-orange">
            Comment ça marche
          </a>
          <a href="#community" className="text-sm font-medium text-tan-600 transition hover:text-brand-orange">
            Communauté
          </a>
          <a href="#faq" className="text-sm font-medium text-tan-600 transition hover:text-brand-orange">
            FAQ
          </a>
        </nav>
        <a href="#download" className="btn-primary !py-2.5 !px-5 text-sm">
          Télécharger
        </a>
      </div>
    </header>
  );
}
