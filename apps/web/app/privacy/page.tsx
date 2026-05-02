import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import {
  LEGAL_LAST_UPDATED,
  PRIVACY_INTRO,
  PRIVACY_SECTIONS,
} from "@/lib/legal-content";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description:
    "Comment NigerConnect collecte, utilise et protège tes données personnelles. Conforme au RGPD et aux standards Apple App Store / Google Play.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Politique de confidentialité"
      lastUpdated={LEGAL_LAST_UPDATED}
      intro={PRIVACY_INTRO}
      sections={PRIVACY_SECTIONS}
      contact="Délégué à la protection des données : privacy@nigerconnect.ne. Réclamation CNIL : cnil.fr."
    />
  );
}
