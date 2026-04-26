import { LegalDoc } from '@/components/legal/LegalDoc';

export default function CommunityRulesScreen() {
  return (
    <LegalDoc
      title="Règles communautaires"
      lastUpdated="24 avril 2026"
      intro="NigerConnect est l’endroit où la diaspora nigérienne se retrouve. Pour que chacun s’y sente bien, quelques règles claires, appliquées sans exception."
      sections={[
        {
          heading: 'Respect avant tout',
          bullets: [
            'Pas d’insultes, de harcèlement ou de menaces.',
            'Pas de discours haineux (race, religion, origine, genre, orientation).',
            'Les désaccords d’opinion sont permis, pas les attaques personnelles.',
          ],
        },
        {
          heading: 'Contenus interdits (bannissement immédiat)',
          bullets: [
            'Nudité, contenus sexuels explicites, pédopornographie.',
            'Incitation à la violence, apologie du terrorisme.',
            'Contenus illégaux selon la loi du Niger ou du pays de résidence.',
            'Arnaques, faux dons, chaînes de Ponzi.',
            'Usurpation d’identité, faux profils.',
          ],
        },
        {
          heading: 'Authenticité',
          bullets: [
            'Utilise ton vrai nom (ou un pseudonyme cohérent sur la durée).',
            'Pas de faux comptes, pas de gonflement artificiel des interactions.',
            'La vérification d’identité est encouragée — elle renforce la confiance.',
          ],
        },
        {
          heading: 'Entraide honnête',
          bullets: [
            'Les demandes d’aide (logement, services, conseils) doivent être sincères.',
            'Pas de sollicitation financière non encadrée.',
            'Respect des engagements pris avec les membres.',
          ],
        },
        {
          heading: 'Si tu vois un contenu qui pose problème',
          body: 'Utilise le bouton 🚩 Signaler sur la publication, le commentaire ou le profil concerné. L’équipe de modération examine chaque signalement sous 24h ouvrées. Pour une urgence (mineur en danger, menace physique), écris-nous directement à safety@nigerconnect.ne.',
        },
        {
          heading: 'Conséquences en cas de violation',
          bullets: [
            'Avertissement sur les infractions mineures.',
            'Suppression du contenu + avertissement.',
            'Suspension temporaire (7 à 30 jours).',
            'Bannissement définitif pour les récidives ou les violations graves.',
          ],
        },
      ]}
      contact="Contester une décision de modération : appeals@nigerconnect.ne. Réponse sous 72 heures."
    />
  );
}
