import type { LegalSection } from "@/components/LegalPage";

/**
 * Source of truth for the legal texts shown both in the mobile app
 * (`apps/mobile/app/legal/*`) and on the public web (`apps/web/app/*`).
 *
 * When you update a text here, mirror the change in the matching
 * `apps/mobile/app/legal/<name>.tsx` so the wording stays consistent —
 * Google Play and the App Store cross-reference the in-app text against
 * the URL we declare during submission.
 */

export const LEGAL_LAST_UPDATED = "1 mai 2026";

export const TERMS_INTRO =
  "Bienvenue sur NigerConnect. En créant un compte et en utilisant l’application, tu acceptes les conditions ci-dessous. Nous nous efforçons de les garder courtes et claires.";

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "1. Qui peut utiliser NigerConnect",
    body:
      "Tu dois avoir au moins 13 ans. Si tu as entre 13 et 18 ans, tu dois avoir l’accord d’un parent ou tuteur. Un seul compte par personne ; les comptes doivent correspondre à une personne réelle (ou à une association légitime).",
  },
  {
    heading: "2. Ton contenu",
    body:
      "Tu restes propriétaire des contenus que tu publies (photos, textes, stories, messages). En les publiant, tu nous accordes une licence mondiale non exclusive pour les afficher dans l’app auprès des personnes autorisées par ton paramètre de confidentialité.",
  },
  {
    heading: "3. Comportement attendu",
    body: "Tolérance zéro pour les contenus suivants :",
    bullets: [
      "Discours haineux, racisme, incitation à la violence",
      "Harcèlement, menaces, intimidation",
      "Nudité, contenu sexuel explicite, pédopornographie",
      "Arnaques, escroqueries, fausses identités",
      "Usurpation d’identité ou faux profils",
      "Spam, publicité déguisée non autorisée",
    ],
  },
  {
    heading: "4. Signalement et modération",
    body:
      "Chaque publication, commentaire et profil peut être signalé depuis l’app. Notre équipe examine chaque signalement sous 24 heures ouvrées et peut retirer le contenu, avertir ou bannir l’auteur. Les décisions sont sans appel en cas de violation grave.",
  },
  {
    heading: "5. Vérification d’identité",
    body:
      "La vérification d’identité (badge ✓) est optionnelle, mais certaines actions (création d’association) la requièrent. Les documents soumis sont chiffrés, ne sont jamais affichés publiquement, et sont supprimés 30 jours après validation.",
  },
  {
    heading: "6. Suppression de compte",
    body:
      "Tu peux supprimer ton compte à tout moment via Paramètres → Supprimer mon compte dans l’app, ou via la page web https://nigerconnect.sahabiguide.com/account-deletion. La suppression est immédiate et supprime toutes tes données — publications, messages, photos, amitiés. Les logs serveur anonymisés sont conservés 30 jours maximum pour prévenir les abus, puis détruits.",
  },
  {
    heading: "7. Limitation de responsabilité",
    body:
      "L’app est fournie « en l’état ». Nous faisons de notre mieux pour la fiabilité et la sécurité, mais nous ne garantissons aucune disponibilité ininterrompue. En cas de litige avec un autre membre, la résolution se fait directement entre les parties ; NigerConnect est un intermédiaire.",
  },
  {
    heading: "8. Modifications",
    body:
      "Nous pouvons mettre à jour ces conditions. Tu seras notifié avant toute modification importante et pourras refuser en supprimant ton compte.",
  },
];

export const PRIVACY_INTRO =
  "Cette politique explique quelles données NigerConnect collecte, pourquoi, et comment tu peux les contrôler. Nous respectons le RGPD (UE), le CCPA (Californie) et les bonnes pratiques des stores Apple et Google.";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "Données que tu fournis",
    bullets: [
      "Identité : prénom, nom, pseudonyme, email, téléphone (optionnel).",
      "Profil : bio, ville, pays, avatar, langues, centres d’intérêt.",
      "Contenu : publications, stories, commentaires, messages, photos.",
      "Vérification d’identité : document officiel — chiffré, stocké max. 30j après validation.",
    ],
  },
  {
    heading: "Données collectées automatiquement",
    bullets: [
      "Position géographique approximative (pays/ville) si tu actives la carte.",
      "Adresse IP, modèle et OS de ton appareil, version de l’app.",
      "Logs d’activité (connexion, actions anti-fraude) conservés 30j max.",
      "Token de notifications push (si tu les autorises).",
    ],
  },
  {
    heading: "Ce que nous NE faisons PAS",
    bullets: [
      "Pas de vente de tes données à des tiers.",
      "Pas de profiling publicitaire.",
      "Pas de traqueurs tiers invisibles (ni Meta Pixel, ni Google Analytics mobile).",
      "Pas de lecture de tes messages privés sans signalement.",
    ],
  },
  {
    heading: "Partenaires techniques (sous-traitants)",
    bullets: [
      "Hébergement et stockage des photos (UE) : Hetzner / Cloudflare.",
      "Firebase Cloud Messaging — acheminement des notifications push.",
      "Resend — envoi des emails transactionnels.",
      "Sentry — collecte d’erreurs techniques anonymisées.",
    ],
  },
  {
    heading: "Tes droits (RGPD)",
    bullets: [
      "Accès : tu peux demander un export complet de tes données à privacy@nigerconnect.ne.",
      "Rectification : modifier ton profil à tout moment depuis l’app.",
      "Effacement : in-app (Paramètres → Supprimer mon compte) ou via /account-deletion.",
      "Portabilité : export au format JSON sur demande.",
      "Opposition : désactiver la géoloc / les notifications à tout moment.",
    ],
  },
  {
    heading: "Durées de conservation",
    bullets: [
      "Compte actif : tant que tu l’utilises.",
      "Après suppression : effacement immédiat de toutes les données visibles.",
      "Logs techniques anonymisés : 30 jours.",
      "Documents d’identité : 30 jours après validation puis destruction.",
    ],
  },
  {
    heading: "Enfants",
    body:
      "L’app est destinée aux personnes de 13 ans et plus (16 ans dans certains pays UE). Si nous apprenons qu’un compte appartient à une personne plus jeune, il est supprimé sans préavis.",
  },
  {
    heading: "Transferts hors UE",
    body:
      "Certains sous-traitants (FCM) sont hors UE. Les transferts reposent sur les Clauses Contractuelles Types de la Commission européenne et un chiffrement en transit.",
  },
  {
    heading: "Permissions demandées par l’app mobile",
    bullets: [
      "Caméra : prendre des photos de profil, de publications, de stories — uniquement quand tu lances l’action.",
      "Photos / Bibliothèque : choisir une photo existante à partager — uniquement quand tu lances l’action.",
      "Localisation (approximative) : afficher ton avatar sur la carte de la diaspora si tu l’actives. Désactivable à tout moment.",
      "Notifications : t’avertir d’un nouveau message, d’une demande d’ami, etc. Désactivables dans les réglages système.",
    ],
  },
];

export const COMMUNITY_INTRO =
  "NigerConnect est l’endroit où la diaspora nigérienne se retrouve. Pour que chacun s’y sente bien, quelques règles claires, appliquées sans exception.";

export const COMMUNITY_SECTIONS: LegalSection[] = [
  {
    heading: "Respect avant tout",
    bullets: [
      "Pas d’insultes, de harcèlement ou de menaces.",
      "Pas de discours haineux (race, religion, origine, genre, orientation).",
      "Les désaccords d’opinion sont permis, pas les attaques personnelles.",
    ],
  },
  {
    heading: "Contenus interdits (bannissement immédiat)",
    bullets: [
      "Nudité, contenus sexuels explicites, pédopornographie.",
      "Incitation à la violence, apologie du terrorisme.",
      "Contenus illégaux selon la loi du Niger ou du pays de résidence.",
      "Arnaques, faux dons, chaînes de Ponzi.",
      "Usurpation d’identité, faux profils.",
    ],
  },
  {
    heading: "Authenticité",
    bullets: [
      "Utilise ton vrai nom (ou un pseudonyme cohérent sur la durée).",
      "Pas de faux comptes, pas de gonflement artificiel des interactions.",
      "La vérification d’identité est encouragée — elle renforce la confiance.",
    ],
  },
  {
    heading: "Entraide honnête",
    bullets: [
      "Les demandes d’aide (logement, services, conseils) doivent être sincères.",
      "Pas de sollicitation financière non encadrée.",
      "Respect des engagements pris avec les membres.",
    ],
  },
  {
    heading: "Si tu vois un contenu qui pose problème",
    body:
      "Utilise le bouton 🚩 Signaler sur la publication, le commentaire ou le profil concerné. L’équipe de modération examine chaque signalement sous 24h ouvrées. Pour une urgence (mineur en danger, menace physique), écris-nous directement à safety@nigerconnect.ne.",
  },
  {
    heading: "Conséquences en cas de violation",
    bullets: [
      "Avertissement sur les infractions mineures.",
      "Suppression du contenu + avertissement.",
      "Suspension temporaire (7 à 30 jours).",
      "Bannissement définitif pour les récidives ou les violations graves.",
    ],
  },
];
