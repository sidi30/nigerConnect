import type { LegalSection } from "@/components/LegalPage";

/**
 * Source of truth for the legal texts shown both in the mobile app
 * (`apps/mobile/app/legal/*`) and on the public web (`apps/web/app/*`).
 *
 * When you update a text here, mirror the change in the matching
 * `apps/mobile/app/legal/<name>.tsx` so the wording stays consistent —
 * Google Play and the App Store cross-reference the in-app text against
 * the URL we declare during submission.
 *
 * NOTE (éditeur) : les champs entre « guillemets » dans MENTIONS_LEGALES_SECTIONS
 * (adresse postale, hébergeur, SIRET le cas échéant) doivent être complétés avec
 * les informations réelles de l'éditeur — des mentions légales incomplètes
 * réduisent la protection juridique au lieu de la renforcer.
 */

export const LEGAL_LAST_UPDATED = "13 juin 2026";

// Contacts officiels — uniformisés sur le domaine nigerconnect.app.
// Prévoir les alias / MX correspondants côté messagerie.
export const LEGAL_CONTACT_EMAIL = "contact@nigerconnect.app";
export const LEGAL_DPO_EMAIL = "dpo@nigerconnect.app";

export const TERMS_CONTACT = `Questions légales : ${LEGAL_CONTACT_EMAIL} — réponse sous 5 jours ouvrés.`;
export const PRIVACY_CONTACT = `Protection des données : ${LEGAL_DPO_EMAIL}. Tu peux aussi introduire une réclamation auprès de la CNIL (cnil.fr).`;
export const COMMUNITY_CONTACT = `Contester une décision de modération : ${LEGAL_CONTACT_EMAIL}. Réponse sous 72 heures.`;
export const MENTIONS_CONTACT = `Toute question relative à l'édition du service : ${LEGAL_CONTACT_EMAIL}.`;

// =============================================================================
// Conditions Générales d'Utilisation (CGU)
// =============================================================================

export const TERMS_INTRO =
  "Les présentes Conditions Générales d'Utilisation (« CGU ») régissent l'accès et l'utilisation de l'application et du site NigerConnect (le « Service »). En créant un compte ou en utilisant le Service, tu reconnais avoir lu, compris et accepté sans réserve l'intégralité des CGU. Si tu n'acceptes pas ces conditions, n'utilise pas le Service.";

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "1. Objet et acceptation",
    body:
      "Le Service est un réseau social destiné à mettre en relation les membres de la diaspora nigérienne. Les CGU forment un contrat entre toi (l'« Utilisateur ») et l'éditeur du Service (l'« Éditeur », identifié dans les Mentions légales). L'utilisation du Service vaut acceptation des CGU, de la Politique de confidentialité et des Règles de la communauté, qui en font partie intégrante.",
  },
  {
    heading: "2. Qui peut utiliser NigerConnect",
    body:
      "Tu dois avoir au moins 15 ans. Entre 13 et 15 ans, l'inscription n'est possible qu'avec l'accord et sous la responsabilité d'un titulaire de l'autorité parentale, qui accepte les présentes CGU en ton nom et demeure responsable de ton utilisation. Le Service est interdit aux moins de 13 ans. Un seul compte par personne ; le compte doit correspondre à une personne réelle ou à une association légitime dûment représentée. Tu garantis que les informations fournies à l'inscription sont exactes et tenues à jour.",
  },
  {
    heading: "3. Compte et sécurité des identifiants",
    body:
      "Tu es seul responsable de la confidentialité de tes identifiants et de toute activité réalisée depuis ton compte. Tu t'engages à nous signaler sans délai toute utilisation non autorisée. L'Éditeur ne saurait être tenu responsable des conséquences d'une divulgation, d'une perte ou d'un usage frauduleux de tes identifiants qui ne lui serait pas imputable.",
  },
  {
    heading: "4. Ton contenu et la licence accordée",
    body:
      "Tu conserves la propriété des contenus que tu publies (photos, textes, stories, commentaires, messages — le « Contenu Utilisateur »). En les publiant, tu concèdes à l'Éditeur une licence mondiale, non exclusive, transférable et sous-licenciable, à titre gratuit, pour héberger, stocker, reproduire, adapter (format/taille), et afficher ton Contenu Utilisateur dans le cadre du fonctionnement du Service, auprès des seules personnes autorisées par tes paramètres de confidentialité. Cette licence prend fin lorsque tu supprimes le Contenu ou ton compte, sous réserve des copies de sauvegarde techniques temporaires et des obligations légales de conservation.",
  },
  {
    heading: "5. Responsabilité et garanties de l'Utilisateur",
    body:
      "Tu es seul responsable de ton Contenu Utilisateur, de tes propos et de tes interactions avec les autres membres. Tu déclares et garantis que :",
    bullets: [
      "tu détiens l'ensemble des droits nécessaires sur le Contenu que tu publies (droits d'auteur, droit à l'image des personnes représentées, etc.) ;",
      "ton Contenu et ton comportement respectent les lois applicables, les droits des tiers, les CGU et les Règles de la communauté ;",
      "tu fais ton affaire personnelle de toute relation, transaction, entraide ou engagement noué avec un autre membre, l'Éditeur n'étant pas partie à ces relations ;",
      "tu n'utilises pas le Service à des fins illégales, frauduleuses, de harcèlement, ou pour collecter les données d'autres membres sans base légale.",
    ],
  },
  {
    heading: "6. Contenus et comportements interdits",
    body: "Sont strictement interdits, sous peine de retrait, suspension ou bannissement immédiat :",
    bullets: [
      "Discours haineux, racisme, incitation à la violence ou à la haine",
      "Harcèlement, menaces, intimidation, atteinte à la vie privée d'autrui",
      "Nudité, contenu sexuel explicite, et — tolérance zéro — toute exploitation de mineurs",
      "Arnaques, escroqueries, sollicitations financières frauduleuses, chaînes de Ponzi",
      "Usurpation d'identité, faux profils, manipulation des interactions",
      "Spam, publicité non autorisée, diffusion de logiciels malveillants",
      "Tout contenu illicite au regard de la loi française, de celle du Niger ou du pays de résidence de l'Utilisateur",
    ],
  },
  {
    heading: "7. Statut d'hébergeur et absence de surveillance générale",
    body:
      "Conformément à l'article 6 de la loi n° 2004-575 du 21 juin 2004 (LCEN) et au Règlement (UE) 2022/2065 (DSA), l'Éditeur agit en qualité d'hébergeur des Contenus Utilisateur : il les stocke à la demande des Utilisateurs sans en être l'auteur. L'Éditeur n'est soumis à aucune obligation générale de surveillance des contenus. Sa responsabilité ne peut être engagée à raison d'un Contenu Utilisateur que s'il en a eu connaissance effective du caractère manifestement illicite et n'a pas agi promptement pour le retirer après notification régulière.",
  },
  {
    heading: "8. Signalement et modération",
    body:
      "Chaque publication, commentaire et profil peut être signalé depuis le Service (bouton 🚩) ou par écrit à " +
      LEGAL_CONTACT_EMAIL +
      ". Les notifications de contenu manifestement illicite sont traitées dans les meilleurs délais (objectif : 24 heures ouvrées). L'Éditeur peut, à sa seule discrétion et sans préavis lorsque la gravité le justifie, retirer un contenu, avertir, suspendre ou bannir un compte, et conserver les éléments nécessaires en cas de réquisition d'une autorité compétente. Une voie de contestation est ouverte à l'adresse de contact.",
  },
  {
    heading: "9. Vérification d'identité",
    body:
      "La vérification d'identité (badge ✓) est facultative, mais certaines fonctionnalités (ex. création d'association) peuvent l'exiger. Les documents transmis sont chiffrés, ne sont jamais rendus publics, et sont supprimés au plus tard 30 jours après validation. La fourniture d'un document falsifié entraîne le bannissement et, le cas échéant, un signalement aux autorités.",
  },
  {
    heading: "10. Propriété intellectuelle du Service",
    body:
      "Le Service, sa marque, ses logos, son interface, son code et ses bases de données sont protégés et demeurent la propriété exclusive de l'Éditeur. Aucune disposition des CGU n'emporte cession de ces droits. Toute reproduction, extraction ou réutilisation non autorisée est interdite.",
  },
  {
    heading: "11. Disponibilité du Service",
    body:
      "Le Service est fourni « en l'état » et « selon disponibilité ». L'Éditeur met en œuvre des moyens raisonnables pour en assurer le fonctionnement mais ne garantit ni une disponibilité ininterrompue, ni l'absence d'erreurs, ni la compatibilité avec tout appareil. Le Service peut être suspendu, modifié ou interrompu, notamment pour maintenance, évolution ou raison de sécurité, sans que cela ouvre droit à indemnité.",
  },
  {
    heading: "12. Limitation de responsabilité",
    body:
      "Dans les limites permises par la loi, l'Éditeur ne saurait être tenu responsable des dommages indirects (perte de données, de chiffre d'affaires, d'opportunité, préjudice d'image) ni des faits, contenus ou comportements des Utilisateurs ou de tiers. La responsabilité de l'Éditeur, lorsqu'elle est engagée, est limitée au préjudice direct et prévisible, et ne saurait excéder les sommes éventuellement versées par l'Utilisateur au titre du Service au cours des douze derniers mois (ou 50 € pour un service gratuit). Aucune stipulation des CGU n'a pour effet d'exclure ou de limiter la responsabilité de l'Éditeur en cas de faute lourde ou dolosive, de dommage corporel, ou dans les cas où la loi l'interdit (notamment droit de la consommation).",
  },
  {
    heading: "13. Garantie et indemnisation par l'Utilisateur",
    body:
      "Tu t'engages à garantir et indemniser l'Éditeur (ainsi que ses éventuels préposés et partenaires) de toute réclamation, action, condamnation, dommage et frais raisonnables (y compris frais de défense) résultant de ton Contenu Utilisateur, de ton utilisation du Service, ou de la violation par tes soins des CGU, de la loi ou des droits d'un tiers.",
  },
  {
    heading: "14. Liens et services de tiers",
    body:
      "Le Service peut renvoyer vers des sites ou services tiers que l'Éditeur ne contrôle pas. L'Éditeur n'assume aucune responsabilité quant à leur contenu, leurs pratiques ou leur disponibilité.",
  },
  {
    heading: "15. Données personnelles",
    body:
      "Le traitement de tes données personnelles est décrit dans la Politique de confidentialité, qui détaille les finalités, bases légales, durées de conservation et tes droits au titre du RGPD. En utilisant le Service, tu en prends connaissance.",
  },
  {
    heading: "16. Suppression de compte",
    body:
      "Tu peux supprimer ton compte à tout moment via Paramètres → Supprimer mon compte, ou via la page https://nigerconnect.app/account-deletion. La suppression est immédiate et efface tes données visibles (publications, messages, photos, relations). Des journaux techniques anonymisés peuvent être conservés jusqu'à 30 jours à des fins de prévention des abus et de sécurité, puis détruits.",
  },
  {
    heading: "17. Modification des CGU",
    body:
      "L'Éditeur peut faire évoluer les CGU. En cas de modification substantielle, tu en seras informé par un moyen approprié (notification ou affichage) avant son entrée en vigueur. La poursuite de l'utilisation du Service vaut acceptation ; à défaut, tu peux résilier en supprimant ton compte.",
  },
  {
    heading: "18. Durée, suspension et résiliation",
    body:
      "Les CGU s'appliquent pendant toute la durée d'utilisation du Service. L'Éditeur peut suspendre ou résilier l'accès d'un Utilisateur qui enfreint les CGU, la loi ou les Règles de la communauté, sans préavis en cas de manquement grave. La résiliation n'affecte pas les stipulations qui, par nature, doivent survivre (propriété intellectuelle, responsabilité, indemnisation, droit applicable).",
  },
  {
    heading: "19. Droit applicable et litiges",
    body:
      "Les CGU sont régies par le droit français. En cas de litige, et après une tentative de résolution amiable auprès de " +
      LEGAL_CONTACT_EMAIL +
      ", l'Utilisateur consommateur peut recourir gratuitement à un médiateur de la consommation. À défaut d'accord, les tribunaux français sont compétents, dans le respect des règles impératives de compétence protectrices du consommateur.",
  },
  {
    heading: "20. Divisibilité",
    body:
      "Si une stipulation des CGU est jugée nulle ou inapplicable, les autres stipulations conservent leur plein effet. Les CGU, la Politique de confidentialité et les Règles de la communauté constituent l'intégralité de l'accord entre l'Utilisateur et l'Éditeur relatif au Service.",
  },
];

// =============================================================================
// Politique de confidentialité (RGPD)
// =============================================================================

export const PRIVACY_INTRO =
  "Cette politique explique quelles données NigerConnect collecte, sur quelles bases légales, pour quelles finalités, et comment tu peux exercer tes droits. Elle est conforme au Règlement (UE) 2016/679 (RGPD) et à la loi Informatique et Libertés. En complément, nous respectons le CCPA (Californie) et les exigences des stores Apple et Google.";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "Responsable du traitement",
    body:
      "Le responsable du traitement est l'Éditeur du Service, identifié dans les Mentions légales. Pour toute question relative à tes données ou pour exercer tes droits, contacte " +
      LEGAL_DPO_EMAIL +
      ".",
  },
  {
    heading: "Données que tu fournis",
    bullets: [
      "Identité : prénom, nom, pseudonyme, email, téléphone (optionnel).",
      "Profil : bio, ville, pays, avatar, langues, centres d'intérêt.",
      "Contenu : publications, stories, commentaires, messages, photos.",
      "Vérification d'identité : document officiel — chiffré, conservé 30 jours max. après validation.",
    ],
  },
  {
    heading: "Données collectées automatiquement",
    bullets: [
      "Position géographique approximative (pays/ville) si tu actives la carte.",
      "Adresse IP, modèle et OS de l'appareil, version de l'app.",
      "Journaux d'activité (connexion, actions, signaux anti-fraude) — 30 jours max.",
      "Données d'usage et de mesure d'audience (pages/écrans vus, fonctionnalités utilisées).",
      "Token de notifications push (si tu les autorises).",
    ],
  },
  {
    heading: "Finalités et bases légales",
    body:
      "Nous ne traitons tes données que pour des finalités déterminées, chacune reposant sur une base légale au sens de l'article 6 du RGPD :",
    bullets: [
      "Fournir et exploiter le Service (compte, feed, messagerie, carte) — exécution du contrat (CGU).",
      "Sécurité, prévention des abus, modération, vérification d'identité — intérêt légitime et respect d'obligations légales.",
      "Mesure d'audience, statistiques, recherche interne et amélioration du Service — intérêt légitime (voir section dédiée ci-dessous).",
      "Notifications non essentielles et communications facultatives — ton consentement, retirable à tout moment.",
      "Géolocalisation sur la carte — ton consentement, désactivable à tout moment.",
    ],
  },
  {
    heading: "Utilisation à des fins statistiques et d'amélioration",
    body:
      "Nous utilisons les données d'usage et de profil pour produire des statistiques, mesurer l'audience, comprendre l'utilisation du Service, détecter les anomalies et améliorer nos fonctionnalités. Ces traitements reposent sur notre intérêt légitime à exploiter, sécuriser et faire évoluer le Service. Les statistiques et indicateurs que nous produisons et conservons à ces fins sont agrégés et/ou anonymisés : une fois anonymisées, ces informations ne permettent plus de t'identifier et ne constituent plus des données personnelles, ce qui nous autorise à les conserver et à les exploiter sans limitation de durée. Nous ne procédons à aucune décision entièrement automatisée produisant des effets juridiques à ton égard. Tu disposes d'un droit d'opposition pour motif tenant à ta situation particulière (voir « Tes droits »).",
  },
  {
    heading: "Ce que nous NE faisons PAS",
    bullets: [
      "Nous ne vendons pas tes données personnelles à des tiers.",
      "Pas de profilage publicitaire ciblé, pas de revente à des courtiers en données.",
      "Pas de traqueurs publicitaires tiers invisibles (ni Meta Pixel, ni Google Analytics mobile).",
      "Pas de lecture de tes messages privés en dehors d'un signalement ou d'une obligation légale.",
    ],
  },
  {
    heading: "Destinataires et sous-traitants",
    body:
      "Tes données ne sont accessibles qu'aux personnes habilitées de l'Éditeur et à des sous-traitants encadrés par contrat (article 28 RGPD), agissant sur instruction :",
    bullets: [
      "Hébergement et stockage des médias (UE) : hébergeur du serveur + Cloudflare (CDN/proxy).",
      "Firebase Cloud Messaging — acheminement des notifications push.",
      "Service d'emails transactionnels (Resend / IONOS) — envoi des emails du Service.",
      "Sentry — collecte d'erreurs techniques aux fins de fiabilité.",
    ],
  },
  {
    heading: "Transferts hors UE",
    body:
      "Certains sous-traitants (ex. Firebase Cloud Messaging) peuvent traiter des données hors UE. Ces transferts sont encadrés par les Clauses Contractuelles Types de la Commission européenne et un chiffrement en transit.",
  },
  {
    heading: "Durées de conservation",
    bullets: [
      "Compte actif : tant que tu utilises le Service.",
      "Après suppression du compte : effacement immédiat des données visibles.",
      "Journaux techniques (sécurité/anti-fraude) : 30 jours max.",
      "Documents d'identité : 30 jours après validation, puis destruction.",
      "Statistiques agrégées/anonymisées : sans limitation (ne constituent plus des données personnelles).",
    ],
  },
  {
    heading: "Tes droits (RGPD)",
    bullets: [
      "Accès et information : obtenir copie de tes données — écris à " + LEGAL_DPO_EMAIL + ".",
      "Rectification : corriger ton profil à tout moment depuis l'app.",
      "Effacement : in-app (Paramètres → Supprimer mon compte) ou via /account-deletion.",
      "Limitation et opposition : t'opposer à un traitement fondé sur l'intérêt légitime, désactiver géoloc/notifications.",
      "Portabilité : export de tes données au format JSON sur demande.",
      "Retrait du consentement : à tout moment, sans effet rétroactif.",
      "Directives post-mortem et réclamation auprès de la CNIL (cnil.fr).",
    ],
  },
  {
    heading: "Sécurité des données",
    body:
      "Nous mettons en œuvre des mesures techniques et organisationnelles adaptées : chiffrement en transit (TLS), hachage des mots de passe, jetons d'authentification signés (RS256) avec révocation, chiffrement des données sensibles au repos, cloisonnement réseau des services et accès restreint aux personnes habilitées. Aucun système n'étant infaillible, nous t'invitons à utiliser un mot de passe fort et unique.",
  },
  {
    heading: "Cookies et traceurs (web)",
    body:
      "Le site utilise les cookies strictement nécessaires à son fonctionnement (session, sécurité). Tout traceur de mesure d'audience non exempté n'est déposé qu'avec ton consentement, recueilli via un bandeau dédié, et retirable à tout moment.",
  },
  {
    heading: "Enfants",
    body:
      "Le Service est destiné aux personnes de 15 ans et plus (13 ans avec l'accord d'un titulaire de l'autorité parentale). Si nous apprenons qu'un compte appartient à une personne plus jeune que l'âge requis, il est supprimé sans préavis.",
  },
  {
    heading: "Permissions demandées par l'app mobile",
    bullets: [
      "Caméra : prendre des photos de profil, de publications, de stories — uniquement à ta demande.",
      "Photos / Bibliothèque : choisir une photo à partager — uniquement à ta demande.",
      "Localisation (approximative) : afficher ton avatar sur la carte de la diaspora si tu l'actives. Désactivable à tout moment.",
      "Notifications : t'avertir d'un message, d'une demande d'ami, etc. Désactivables dans les réglages système.",
    ],
  },
  {
    heading: "Modifications de la politique",
    body:
      "Cette politique peut évoluer. En cas de changement substantiel, tu en seras informé avant son entrée en vigueur. La date de dernière mise à jour figure en tête du document.",
  },
];

// =============================================================================
// Règles de la communauté
// =============================================================================

export const COMMUNITY_INTRO =
  "NigerConnect est l'endroit où la diaspora nigérienne se retrouve. Pour que chacun s'y sente bien, quelques règles claires, appliquées sans exception.";

export const COMMUNITY_SECTIONS: LegalSection[] = [
  {
    heading: "Respect avant tout",
    bullets: [
      "Pas d'insultes, de harcèlement ou de menaces.",
      "Pas de discours haineux (race, religion, origine, genre, orientation).",
      "Les désaccords d'opinion sont permis, pas les attaques personnelles.",
    ],
  },
  {
    heading: "Contenus interdits (bannissement immédiat)",
    bullets: [
      "Nudité, contenus sexuels explicites, exploitation de mineurs.",
      "Incitation à la violence, apologie du terrorisme.",
      "Contenus illégaux selon la loi du Niger ou du pays de résidence.",
      "Arnaques, faux dons, chaînes de Ponzi.",
      "Usurpation d'identité, faux profils.",
    ],
  },
  {
    heading: "Authenticité",
    bullets: [
      "Utilise ton vrai nom (ou un pseudonyme cohérent sur la durée).",
      "Pas de faux comptes, pas de gonflement artificiel des interactions.",
      "La vérification d'identité est encouragée — elle renforce la confiance.",
    ],
  },
  {
    heading: "Entraide honnête",
    bullets: [
      "Les demandes d'aide (logement, services, conseils) doivent être sincères.",
      "Pas de sollicitation financière non encadrée.",
      "Respect des engagements pris avec les membres.",
    ],
  },
  {
    heading: "Si tu vois un contenu qui pose problème",
    body:
      "Utilise le bouton 🚩 Signaler sur la publication, le commentaire ou le profil concerné. L'équipe de modération examine chaque signalement sous 24h ouvrées. Pour une urgence (mineur en danger, menace physique), écris-nous directement à " +
      LEGAL_CONTACT_EMAIL +
      ".",
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

// =============================================================================
// Mentions légales (LCEN art. 6-III) — À COMPLÉTER par l'éditeur
// =============================================================================

export const MENTIONS_LEGALES_INTRO =
  "Informations relatives à l'éditeur et à l'hébergeur du service NigerConnect, conformément à la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique (LCEN).";

export const MENTIONS_LEGALES_SECTIONS: LegalSection[] = [
  {
    heading: "Éditeur du service",
    bullets: [
      "Éditeur : Ramzi SIDI IBRAHIM (entrepreneur individuel).",
      "Adresse : « adresse postale de l'éditeur — à compléter ».",
      "Contact : " + LEGAL_CONTACT_EMAIL + ".",
      "« SIRET / numéro d'identification, le cas échéant — à compléter ».",
    ],
  },
  {
    heading: "Directeur de la publication",
    body: "Le directeur de la publication est Ramzi SIDI IBRAHIM, en sa qualité d'éditeur.",
  },
  {
    heading: "Hébergement",
    bullets: [
      "Hébergeur du serveur : « nom et adresse de l'hébergeur du VPS — à compléter ».",
      "Réseau de diffusion / proxy : Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, USA.",
    ],
  },
  {
    heading: "Propriété intellectuelle",
    body:
      "L'ensemble des éléments du service (marque, logos, interface, code, bases de données) est protégé par le droit de la propriété intellectuelle et demeure la propriété exclusive de l'éditeur, sauf mention contraire. Toute reproduction ou réutilisation non autorisée est interdite.",
  },
  {
    heading: "Signalement de contenu illicite",
    body:
      "Tout contenu manifestement illicite peut être signalé via le bouton 🚩 dans l'application ou par écrit à " +
      LEGAL_CONTACT_EMAIL +
      ", conformément à l'article 6 de la LCEN.",
  },
  {
    heading: "Médiation de la consommation",
    body:
      "Conformément aux articles L.611-1 et suivants du Code de la consommation, le consommateur peut recourir gratuitement à un médiateur de la consommation en vue de la résolution amiable d'un litige. Les coordonnées du médiateur compétent seront communiquées sur demande à " +
      LEGAL_CONTACT_EMAIL +
      ".",
  },
];
