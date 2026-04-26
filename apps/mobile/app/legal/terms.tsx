import { LegalDoc } from '@/components/legal/LegalDoc';

export default function TermsScreen() {
  return (
    <LegalDoc
      title="Conditions d’utilisation"
      lastUpdated="24 avril 2026"
      intro="Bienvenue sur NigerConnect. En créant un compte et en utilisant l’application, tu acceptes les conditions ci-dessous. Nous nous efforçons de les garder courtes et claires."
      sections={[
        {
          heading: '1. Qui peut utiliser NigerConnect',
          body: 'Tu dois avoir au moins 13 ans. Si tu as entre 13 et 18 ans, tu dois avoir l’accord d’un parent ou tuteur. Un seul compte par personne ; les comptes doivent correspondre à une personne réelle (ou à une association légitime).',
        },
        {
          heading: '2. Ton contenu',
          body: 'Tu restes propriétaire des contenus que tu publies (photos, textes, stories, messages). En les publiant, tu nous accordes une licence mondiale non exclusive pour les afficher dans l’app auprès des personnes autorisées par ton paramètre de confidentialité.',
        },
        {
          heading: '3. Comportement attendu',
          body: 'Tolérance zéro pour les contenus suivants :',
          bullets: [
            'Discours haineux, racisme, incitation à la violence',
            'Harcèlement, menaces, intimidation',
            'Nudité, contenu sexuel explicite, pédopornographie',
            'Arnaques, escroqueries, fausses identités',
            'Usurpation d’identité ou faux profils',
            'Spam, publicité déguisée non autorisée',
          ],
        },
        {
          heading: '4. Signalement et modération',
          body: 'Chaque publication, commentaire et profil peut être signalé depuis l’app. Notre équipe examine chaque signalement sous 24 heures ouvrées et peut retirer le contenu, avertir ou bannir l’auteur. Les décisions sont sans appel en cas de violation grave.',
        },
        {
          heading: '5. Vérification d’identité',
          body: 'La vérification d’identité (badge ✓) est optionnelle, mais certaines actions (création d’association) la requièrent. Les documents soumis sont chiffrés, ne sont jamais affichés publiquement, et sont supprimés 30 jours après validation.',
        },
        {
          heading: '6. Suppression de compte',
          body: 'Tu peux supprimer ton compte à tout moment via Paramètres → Supprimer mon compte. La suppression est immédiate et supprime toutes tes données — publications, messages, photos, amitiés. Les logs serveur anonymisés sont conservés 30 jours maximum pour prévenir les abus, puis détruits.',
        },
        {
          heading: '7. Limitation de responsabilité',
          body: 'L’app est fournie « en l’état ». Nous faisons de notre mieux pour la fiabilité et la sécurité, mais nous ne garantissons aucune disponibilité ininterrompue. En cas de litige avec un autre membre, la résolution se fait directement entre les parties ; NigerConnect est un intermédiaire.',
        },
        {
          heading: '8. Modifications',
          body: 'Nous pouvons mettre à jour ces conditions. Tu seras notifié avant toute modification importante et pourras refuser en supprimant ton compte.',
        },
      ]}
      contact="Questions légales : legal@nigerconnect.ne — l’équipe répond sous 5 jours ouvrés."
    />
  );
}
