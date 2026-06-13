import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import {
  LEGAL_LAST_UPDATED,
  TERMS_INTRO,
  TERMS_SECTIONS,
  TERMS_CONTACT,
} from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "Conditions d’utilisation",
  description:
    "Conditions générales d’utilisation de NigerConnect — droits, devoirs, modération, suppression de compte.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Conditions d’utilisation"
      lastUpdated={LEGAL_LAST_UPDATED}
      intro={TERMS_INTRO}
      sections={TERMS_SECTIONS}
      contact={TERMS_CONTACT}
    />
  );
}
