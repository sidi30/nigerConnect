import { LegalDoc } from '@/components/legal/LegalDoc';

export default function PrivacyScreen() {
  return (
    <LegalDoc
      title="Confidentialité"
      lastUpdated="24 avril 2026"
      intro="Cette politique explique quelles données NigerConnect collecte, pourquoi, et comment tu peux les contrôler. Nous respectons le RGPD (UE), le CCPA (Californie) et les bonnes pratiques des stores Apple et Google."
      sections={[
        {
          heading: 'Données que tu fournis',
          bullets: [
            'Identité : prénom, nom, pseudonyme, email, téléphone (optionnel).',
            'Profil : bio, ville, pays, avatar, langues, centres d’intérêt.',
            'Contenu : publications, stories, commentaires, messages, photos.',
            'Vérification d’identité : document officiel — chiffré, stocké max. 30j après validation.',
          ],
        },
        {
          heading: 'Données collectées automatiquement',
          bullets: [
            'Position géographique approximative (pays/ville) si tu actives la carte.',
            'Adresse IP, modèle et OS de ton appareil, version de l’app.',
            'Logs d’activité (connexion, actions anti-fraude) conservés 30j max.',
            'Token de notifications push (si tu les autorises).',
          ],
        },
        {
          heading: 'Ce que nous NE faisons PAS',
          bullets: [
            'Pas de vente de tes données à des tiers.',
            'Pas de profiling publicitaire.',
            'Pas de traqueurs tiers invisibles (ni Meta Pixel, ni Google Analytics mobile).',
            'Pas de lecture de tes messages privés sans signalement.',
          ],
        },
        {
          heading: 'Partenaires techniques (sous-traitants)',
          bullets: [
            'AWS / Cloudflare R2 — stockage des photos (UE).',
            'Firebase Cloud Messaging — acheminement des notifications push.',
            'Resend — envoi des emails transactionnels.',
          ],
        },
        {
          heading: 'Tes droits (RGPD)',
          bullets: [
            'Accès : tu peux demander un export complet de tes données.',
            'Rectification : modifier ton profil à tout moment depuis l’app.',
            'Effacement : Paramètres → Supprimer mon compte (immédiat).',
            'Portabilité : export au format JSON sur demande.',
            'Opposition : désactiver la géoloc / les notifications à tout moment.',
          ],
        },
        {
          heading: 'Durées de conservation',
          bullets: [
            'Compte actif : tant que tu l’utilises.',
            'Après suppression : effacement immédiat de toutes les données visibles.',
            'Logs techniques anonymisés : 30 jours.',
            'Documents d’identité : 30 jours après validation puis destruction.',
          ],
        },
        {
          heading: 'Enfants',
          body: 'L’app est destinée aux personnes de 13 ans et plus (16 ans dans certains pays UE). Si nous apprenons qu’un compte appartient à une personne plus jeune, il est supprimé sans préavis.',
        },
        {
          heading: 'Transferts hors UE',
          body: 'Certains sous-traitants (FCM) sont hors UE. Les transferts reposent sur les Clauses Contractuelles Types de la Commission européenne et un chiffrement en transit.',
        },
      ]}
      contact="Délégué à la protection des données : contact@sahabiguide.com. Réclamation CNIL : cnil.fr."
    />
  );
}
