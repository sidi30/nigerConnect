import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import {
  LEGAL_LAST_UPDATED,
  COMMUNITY_INTRO,
  COMMUNITY_SECTIONS,
} from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "Règles de la communauté",
  description:
    "Charte de la communauté NigerConnect : respect, contenus interdits, authenticité, modération.",
  alternates: { canonical: "/community" },
};

export default function CommunityPage() {
  return (
    <LegalPage
      title="Règles de la communauté"
      lastUpdated={LEGAL_LAST_UPDATED}
      intro={COMMUNITY_INTRO}
      sections={COMMUNITY_SECTIONS}
      contact="Contester une décision de modération : appeals@nigerconnect.ne. Réponse sous 72 heures."
    />
  );
}
