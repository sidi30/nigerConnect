import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import {
  LEGAL_LAST_UPDATED,
  MENTIONS_LEGALES_INTRO,
  MENTIONS_LEGALES_SECTIONS,
  MENTIONS_CONTACT,
} from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "Mentions légales",
  description:
    "Mentions légales de NigerConnect — éditeur, directeur de la publication, hébergeur, propriété intellectuelle (LCEN).",
  alternates: { canonical: "/mentions-legales" },
};

export default function MentionsLegalesPage() {
  return (
    <LegalPage
      title="Mentions légales"
      lastUpdated={LEGAL_LAST_UPDATED}
      intro={MENTIONS_LEGALES_INTRO}
      sections={MENTIONS_LEGALES_SECTIONS}
      contact={MENTIONS_CONTACT}
    />
  );
}
