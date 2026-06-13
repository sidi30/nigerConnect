import { LegalDoc } from '@/components/legal/LegalDoc';

export default function TermsScreen() {
  return (
    <LegalDoc
      title="Conditions d’utilisation"
      lastUpdated="13 juin 2026"
      intro="Les présentes Conditions Générales d’Utilisation (« CGU ») régissent l’accès et l’utilisation de l’application et du site NigerConnect (le « Service »). En créant un compte ou en utilisant le Service, tu reconnais avoir lu, compris et accepté sans réserve l’intégralité des CGU. Si tu n’acceptes pas ces conditions, n’utilise pas le Service."
      sections={[
        {
          heading: '1. Objet et acceptation',
          body: 'Le Service est un réseau social destiné à mettre en relation les membres de la diaspora nigérienne. Les CGU forment un contrat entre toi (l’« Utilisateur ») et l’éditeur du Service (l’« Éditeur », identifié dans les Mentions légales). L’utilisation du Service vaut acceptation des CGU, de la Politique de confidentialité et des Règles de la communauté.',
        },
        {
          heading: '2. Qui peut utiliser NigerConnect',
          body: 'Tu dois avoir au moins 15 ans. Entre 13 et 15 ans, l’inscription n’est possible qu’avec l’accord et sous la responsabilité d’un titulaire de l’autorité parentale. Le Service est interdit aux moins de 13 ans. Un seul compte par personne ; le compte doit correspondre à une personne réelle ou à une association légitime. Tu garantis l’exactitude des informations fournies.',
        },
        {
          heading: '3. Compte et sécurité des identifiants',
          body: 'Tu es seul responsable de la confidentialité de tes identifiants et de toute activité réalisée depuis ton compte. Signale-nous sans délai toute utilisation non autorisée. L’Éditeur n’est pas responsable d’un usage frauduleux de tes identifiants qui ne lui serait pas imputable.',
        },
        {
          heading: '4. Ton contenu et la licence accordée',
          body: 'Tu conserves la propriété des contenus que tu publies (le « Contenu Utilisateur »). En les publiant, tu concèdes à l’Éditeur une licence mondiale, non exclusive, gratuite, pour héberger, stocker, adapter (format/taille) et afficher ton Contenu auprès des seules personnes autorisées par tes paramètres de confidentialité. Cette licence prend fin à la suppression du Contenu ou du compte, sous réserve des sauvegardes techniques temporaires et obligations légales.',
        },
        {
          heading: '5. Responsabilité et garanties de l’Utilisateur',
          body: 'Tu es seul responsable de ton Contenu, de tes propos et de tes interactions. Tu déclares et garantis que :',
          bullets: [
            'tu détiens les droits nécessaires sur le Contenu publié (droits d’auteur, droit à l’image) ;',
            'ton Contenu et ton comportement respectent la loi, les droits des tiers et les présentes règles ;',
            'tu fais ton affaire personnelle de toute relation ou transaction avec un autre membre ;',
            'tu n’utilises pas le Service à des fins illégales, frauduleuses ou de harcèlement.',
          ],
        },
        {
          heading: '6. Contenus et comportements interdits',
          body: 'Sont strictement interdits, sous peine de retrait, suspension ou bannissement immédiat :',
          bullets: [
            'Discours haineux, racisme, incitation à la violence',
            'Harcèlement, menaces, intimidation, atteinte à la vie privée',
            'Nudité, contenu sexuel explicite, exploitation de mineurs (tolérance zéro)',
            'Arnaques, escroqueries, sollicitations frauduleuses, chaînes de Ponzi',
            'Usurpation d’identité, faux profils, manipulation des interactions',
            'Spam, publicité non autorisée, logiciels malveillants',
            'Tout contenu illicite (loi française, du Niger ou du pays de résidence)',
          ],
        },
        {
          heading: '7. Statut d’hébergeur',
          body: 'Conformément à l’article 6 de la LCEN et au Règlement (UE) 2022/2065 (DSA), l’Éditeur agit en qualité d’hébergeur des Contenus Utilisateur, sans obligation générale de surveillance. Sa responsabilité ne peut être engagée à raison d’un Contenu que s’il en a eu connaissance effective du caractère manifestement illicite et n’a pas agi promptement après notification régulière.',
        },
        {
          heading: '8. Signalement et modération',
          body: 'Chaque publication, commentaire et profil peut être signalé (bouton 🚩) ou par écrit à contact@nigerconnect.app. Les contenus manifestement illicites sont traités dans les meilleurs délais (objectif 24h ouvrées). L’Éditeur peut retirer un contenu, avertir, suspendre ou bannir un compte, à sa discrétion et sans préavis en cas de gravité. Une voie de contestation est ouverte.',
        },
        {
          heading: '9. Vérification d’identité',
          body: 'La vérification (badge ✓) est facultative mais certaines actions (création d’association) peuvent l’exiger. Les documents sont chiffrés, jamais publics, et supprimés au plus tard 30 jours après validation. Un document falsifié entraîne le bannissement et, le cas échéant, un signalement aux autorités.',
        },
        {
          heading: '10. Propriété intellectuelle du Service',
          body: 'Le Service, sa marque, ses logos, son interface, son code et ses bases de données demeurent la propriété exclusive de l’Éditeur. Toute reproduction ou réutilisation non autorisée est interdite.',
        },
        {
          heading: '11. Disponibilité',
          body: 'Le Service est fourni « en l’état » et « selon disponibilité ». L’Éditeur met en œuvre des moyens raisonnables mais ne garantit ni disponibilité ininterrompue, ni absence d’erreurs. Le Service peut être suspendu ou modifié (maintenance, sécurité) sans droit à indemnité.',
        },
        {
          heading: '12. Limitation de responsabilité',
          body: 'Dans les limites permises par la loi, l’Éditeur n’est pas responsable des dommages indirects ni des faits, contenus ou comportements des Utilisateurs ou tiers. Sa responsabilité, lorsqu’elle est engagée, est limitée au préjudice direct et prévisible et ne saurait excéder les sommes versées au titre du Service sur les 12 derniers mois (ou 50 € pour un service gratuit). Aucune limitation ne s’applique en cas de faute lourde ou dolosive, de dommage corporel, ou lorsque la loi l’interdit.',
        },
        {
          heading: '13. Garantie et indemnisation',
          body: 'Tu t’engages à garantir et indemniser l’Éditeur de toute réclamation, condamnation, dommage et frais raisonnables (y compris frais de défense) résultant de ton Contenu, de ton utilisation du Service, ou de la violation des CGU, de la loi ou des droits d’un tiers.',
        },
        {
          heading: '14. Données personnelles',
          body: 'Le traitement de tes données est décrit dans la Politique de confidentialité (finalités, bases légales, durées, droits RGPD). En utilisant le Service, tu en prends connaissance.',
        },
        {
          heading: '15. Suppression de compte',
          body: 'Tu peux supprimer ton compte à tout moment via Paramètres → Supprimer mon compte. La suppression est immédiate et efface tes données visibles. Des journaux techniques anonymisés peuvent être conservés jusqu’à 30 jours à des fins de sécurité, puis détruits.',
        },
        {
          heading: '16. Modification des CGU',
          body: 'L’Éditeur peut faire évoluer les CGU. En cas de modification substantielle, tu seras informé avant son entrée en vigueur. La poursuite de l’utilisation vaut acceptation ; à défaut, tu peux résilier en supprimant ton compte.',
        },
        {
          heading: '17. Droit applicable et litiges',
          body: 'Les CGU sont régies par le droit français. Après tentative de résolution amiable (contact@nigerconnect.app), le consommateur peut recourir à un médiateur de la consommation. À défaut d’accord, les tribunaux français sont compétents, dans le respect des règles protectrices du consommateur.',
        },
      ]}
      contact="Questions légales : contact@nigerconnect.app — réponse sous 5 jours ouvrés."
    />
  );
}
