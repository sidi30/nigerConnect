import { LegalDoc } from '@/components/legal/LegalDoc';

export default function PrivacyScreen() {
  return (
    <LegalDoc
      title="Confidentialité"
      lastUpdated="21 août 2026"
      intro="Cette politique explique quelles données NigerConnect collecte, sur quelles bases légales, pour quelles finalités, et comment exercer tes droits. Elle est conforme au RGPD (UE) 2016/679 et à la loi Informatique et Libertés. Nous respectons aussi le CCPA (Californie) et les exigences des stores Apple et Google."
      sections={[
        {
          heading: 'Responsable du traitement',
          body: "Le responsable du traitement est l'Éditeur du Service, identifié dans les Mentions légales. Pour exercer tes droits ou toute question sur tes données : contact@nigerconnect.app.",
        },
        {
          heading: 'Données que tu fournis',
          bullets: [
            "Identité : prénom, nom, pseudonyme, email, téléphone (optionnel).",
            "Profil : bio, ville, pays, avatar, langues, centres d'intérêt.",
            'Contenu : publications, stories, commentaires, messages, photos.',
            "Vérification d'identité : document officiel — chiffré. Conservé 30 jours en base active après examen, puis placé en archive intermédiaire scellée (voir « Durées de conservation »).",
          ],
        },
        {
          heading: 'Données collectées automatiquement',
          bullets: [
            'Position géographique approximative (pays/ville) si tu actives la carte.',
            "Adresse IP, modèle et OS de l'appareil, version de l'app.",
            "Journaux d'activité (connexion, signaux anti-fraude) — 30j max.",
            "Données d'usage et de mesure d'audience (écrans vus, fonctionnalités utilisées).",
            'Token de notifications push (si tu les autorises).',
          ],
        },
        {
          heading: 'Finalités et bases légales',
          body: 'Chaque traitement repose sur une base légale (art. 6 RGPD) :',
          bullets: [
            'Fournir le Service (compte, feed, messagerie, carte) — exécution du contrat.',
            'Sécurité, anti-abus, modération, vérification — intérêt légitime et obligations légales.',
            "Statistiques, mesure d'audience et amélioration — intérêt légitime (voir ci-dessous).",
            'Notifications non essentielles — ton consentement, retirable à tout moment.',
            'Géolocalisation sur la carte — ton consentement, désactivable à tout moment.',
          ],
        },
        {
          heading: 'Statistiques et amélioration du Service',
          body: "Nous utilisons les données d'usage et de profil pour produire des statistiques, mesurer l'audience, comprendre l'utilisation du Service, détecter les anomalies et améliorer nos fonctionnalités, sur la base de notre intérêt légitime. Les statistiques que nous conservons à ces fins sont agrégées et/ou anonymisées : une fois anonymisées, elles ne permettent plus de t'identifier, ne constituent plus des données personnelles, et peuvent être conservées sans limitation de durée. Aucune décision entièrement automatisée produisant des effets juridiques n'est prise à ton égard. Tu disposes d'un droit d'opposition pour motif tenant à ta situation particulière.",
        },
        {
          heading: 'Ce que nous NE faisons PAS',
          bullets: [
            'Nous ne vendons pas tes données personnelles.',
            'Pas de profilage publicitaire ciblé, pas de revente à des courtiers en données.',
            'Pas de traqueurs publicitaires tiers invisibles (ni Meta Pixel, ni Google Analytics mobile).',
            'Pas de lecture de tes messages privés hors signalement ou obligation légale.',
          ],
        },
        {
          heading: 'Destinataires et sous-traitants',
          bullets: [
            'Hébergement et stockage des médias (UE) + Cloudflare (CDN/proxy).',
            'Firebase Cloud Messaging — acheminement des notifications push.',
            "Service d'emails transactionnels (Resend / IONOS).",
            "Sentry — collecte d'erreurs techniques pour la fiabilité.",
          ],
        },
        {
          heading: 'Tes droits (RGPD)',
          bullets: [
            'Accès : obtenir copie de tes données — écris à contact@nigerconnect.app.',
            "Rectification : modifier ton profil à tout moment depuis l'app.",
            'Effacement : Paramètres → Supprimer mon compte (immédiat).',
            "Limitation / opposition : t'opposer aux traitements fondés sur l'intérêt légitime.",
            'Portabilité : export au format JSON sur demande.',
            'Retrait du consentement et réclamation auprès de la CNIL (cnil.fr).',
          ],
        },
        {
          heading: 'Parrainage',
          body: "NigerConnect propose deux façons d'inviter des proches :",
          bullets: [
            "Invitation par email : lorsque tu saisis l'adresse email d'une personne et valides l'envoi, la plateforme lui envoie un email d'invitation et conserve cette adresse tant que l'invitation est en attente. Dès que l'invitation est acceptée, expirée ou révoquée, l'adresse email est supprimée. Base légale : intérêt légitime / exécution de l'invitation que tu as demandée. En soumettant une adresse email, tu certifies que tu connais la personne et qu'elle est susceptible de souhaiter être invitée.",
            "Invitation par lien : tu génères un lien et tu le partages toi-même (WhatsApp, SMS, etc.). Nous ne collectons ni ne conservons l'adresse email ni le numéro des personnes non-inscrites.",
            "Lorsqu'un filleul crée un compte, nous conservons le lien de parrainage entre vos comptes (intérêt légitime : prévention de la fraude, mesure de la croissance). Cette information est agrégée pour nos statistiques.",
          ],
        },
        {
          heading: 'Durées de conservation',
          bullets: [
            "Compte actif : tant que tu l'utilises.",
            'Après suppression : effacement immédiat des données visibles.',
            'Journaux techniques : 30 jours max.',
            "Documents d'identité — base active : 30 jours après examen de ta demande. Passé ce délai, le document quitte le système actif : plus personne, y compris nos équipes, ne peut le consulter depuis l'application ou l'espace d'administration.",
            "Documents d'identité — archive intermédiaire : le document validé est ensuite scellé dans une archive chiffrée à accès restreint, conservée 5 ans après la suppression de ton compte, puis effacée définitivement. Un document refusé y est conservé 1 an, puis effacé. Un document déposé mais jamais examiné est détruit au bout de 90 jours, sans archivage.",
            "Finalité de cette archive : constatation, exercice ou défense d'un droit en justice, et confirmation de ton identité en cas de réquisition d'une autorité ou de contestation (usurpation, fraude). Base légale : intérêt légitime. Elle n'est utilisée à aucune autre fin — ni modération courante, ni statistiques, ni personnalisation.",
            "Accès à l'archive : aucun accès depuis l'application ni depuis l'administration. L'ouverture d'un document archivé exige une clé de déchiffrement conservée hors ligne, un motif écrit, et laisse une trace horodatée et inaltérable. Ton droit d'effacement s'exerce sur toutes tes autres données ; il ne s'étend pas à cette archive tant que sa durée court, l'archivage reposant sur la défense d'un droit en justice.",
            "Statistiques agrégées/anonymisées : sans limitation (plus des données personnelles).",
          ],
        },
        {
          heading: 'Sécurité des données',
          body: "Mesures techniques et organisationnelles : chiffrement en transit (TLS), hachage des mots de passe, jetons signés (RS256) avec révocation, chiffrement des données sensibles au repos, cloisonnement réseau et accès restreint. Les pièces d'identité archivées bénéficient d'une protection renforcée : stockage isolé du reste du Service, scellement empêchant toute modification ou suppression anticipée, et chiffrement dont la clé de lecture n'est jamais présente sur nos serveurs. Aucun système n'étant infaillible, utilise un mot de passe fort et unique.",
        },
        {
          heading: 'Fiches d’adhérents créées par une association',
          body:
            'Une association peut enregistrer, dans son espace, des adhérents qui n’ont pas de compte NigerConnect. Dans ce cas, c’est l’association — et non NigerConnect — qui décide des données enregistrées et de leur finalité : elle en est responsable du traitement, nous n’en sommes que l’hébergeur technique. Ces fiches se limitent à un nom et à un moyen de contact ; elles ne sont jamais publiées, jamais utilisées pour du ciblage, et n’entrent jamais dans le réseau social (ni carte, ni recherche, ni fil, ni suggestions d’amis). Elles ne reçoivent aucune notification. Pour faire rectifier ou supprimer une fiche te concernant, écris à l’association, ou à contact@nigerconnect.app : nous transmettons la demande et pouvons supprimer la fiche nous-mêmes si l’association n’y répond pas. La suppression de l’espace d’une association entraîne celle de ses fiches.',
        },
        {
          heading: 'Transferts hors UE',
          body: 'Certains sous-traitants (ex. Firebase Cloud Messaging) peuvent traiter des données hors UE. Ces transferts sont encadrés par les Clauses Contractuelles Types de la Commission européenne et un chiffrement en transit.',
        },
        {
          heading: 'Enfants',
          body: "Le Service est destiné aux personnes de 15 ans et plus (13 ans avec l'accord d'un titulaire de l'autorité parentale). Un compte appartenant à une personne plus jeune que l'âge requis est supprimé sans préavis.",
        },
      ]}
      contact="Protection des données : contact@nigerconnect.app. Réclamation CNIL : cnil.fr."
    />
  );
}
