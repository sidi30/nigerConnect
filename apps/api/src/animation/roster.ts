import type { AnimationKind } from '@prisma/client';

/**
 * Les 25 comptes d'animation, répartis sur les bassins réels de la communauté
 * (relevé du 18/08/2026 : FR 68 membres, NE 57, TR 44, MA 16, US+CA 14, reste 47).
 *
 * La répartition n'est pas décorative : la Turquie pèse 44 membres pour 2
 * publications, le Maroc 16 pour 1. C'est là que le fil est démographiquement
 * vivant et éditorialement mort, donc c'est là que portent les comptes.
 *
 * `handle` sert de clé d'idempotence : créer le roster deux fois ne crée pas
 * cinquante comptes. L'e-mail en dérive (`+ncNN`), il n'est jamais affiché.
 */
export interface RosterEntry {
  /** nc01…nc25 — stable, sert de clé de reprise et de nom de fichier photo. */
  handle: string;
  firstName: string;
  lastName: string;
  city: string;
  countryCode: string;
  /** Rôle éditorial dominant. Un compte `law` ne publie jamais sans validation. */
  kind: AnimationKind;
  bio: string;
}

/** Boîte de réception réelle du propriétaire — le plus-adressage isole les 25. */
const MAILBOX = 'rsidiibrahim';

export const emailFor = (handle: string): string => `${MAILBOX}+${handle}@gmail.com`;

export const ROSTER: readonly RosterEntry[] = [
  // ── France (8) ──────────────────────────────────────────────
  { handle: 'nc01', firstName: 'Hadiza', lastName: 'Seyni', city: 'Paris', countryCode: 'FR', kind: 'law', bio: 'Étudiante à Paris. Je partage ce que j’apprends sur les titres de séjour.' },
  { handle: 'nc02', firstName: 'Balkissa', lastName: 'Oumarou', city: 'Lyon', countryCode: 'FR', kind: 'tip', bio: 'Étudiante à Lyon. Logement, CROUS, bons plans pour s’en sortir.' },
  { handle: 'nc03', firstName: 'Rakia', lastName: 'Mounkaila', city: 'Toulouse', countryCode: 'FR', kind: 'chat', bio: 'Étudiante à Toulouse. Toujours partante pour donner un coup de main.' },
  { handle: 'nc04', firstName: 'Salamatou', lastName: 'Garba', city: 'Marseille', countryCode: 'FR', kind: 'law', bio: 'Aide-soignante à Marseille. Passée du titre étudiant au salarié.' },
  { handle: 'nc05', firstName: 'Mariama', lastName: 'Alzouma', city: 'Lille', countryCode: 'FR', kind: 'tip', bio: 'Comptable à Lille. Je regarde de près les frais d’envoi au pays.' },
  { handle: 'nc06', firstName: 'Abdoulaye', lastName: 'Maïga', city: 'Paris', countryCode: 'FR', kind: 'law', bio: 'Étudiant à Paris. Permis, assurance, papiers — j’ai fait les démarches.' },
  { handle: 'nc07', firstName: 'Moussa', lastName: 'Boureima', city: 'Lyon', countryCode: 'FR', kind: 'chat', bio: 'Étudiant à Lyon. Foot le week-end, révisions la semaine.' },
  { handle: 'nc08', firstName: 'Souleymane', lastName: 'Zakari', city: 'Paris', countryCode: 'FR', kind: 'tip', bio: 'Chauffeur à Paris. Billets, bagages, colis pour Niamey.' },

  // ── Turquie (6) — 44 membres, 2 publications : le vrai angle mort ──
  { handle: 'nc09', firstName: 'Aïcha', lastName: 'Hamidou', city: 'Bursa', countryCode: 'TR', kind: 'law', bio: 'Étudiante à Bursa. Ikamet, assurance, renouvellements.' },
  { handle: 'nc10', firstName: 'Zeinabou', lastName: 'Issaka', city: 'Istanbul', countryCode: 'TR', kind: 'tip', bio: 'Étudiante à Istanbul. Loyers, transport, où ça coûte moins cher.' },
  { handle: 'nc11', firstName: 'Nafissa', lastName: 'Illiassou', city: 'Konya', countryCode: 'TR', kind: 'chat', bio: 'Étudiante à Konya. Cuisine du pays loin du pays.' },
  { handle: 'nc12', firstName: 'Habsatou', lastName: 'Karimou', city: 'Ankara', countryCode: 'TR', kind: 'law', bio: 'Traductrice à Ankara. Permis de travail et équivalences.' },
  { handle: 'nc13', firstName: 'Harouna', lastName: 'Tahirou', city: 'Bursa', countryCode: 'TR', kind: 'tip', bio: 'Étudiant boursier à Bursa. Ce qui est gratuit et qu’on fait payer.' },
  { handle: 'nc14', firstName: 'Yacouba', lastName: 'Moumouni', city: 'Istanbul', countryCode: 'TR', kind: 'chat', bio: 'Ingénieur à Istanbul. Stages, premiers emplois, entretiens.' },

  // ── Niger (5) — côté « maison » du split diaspora ──
  { handle: 'nc15', firstName: 'Fatouma', lastName: 'Abdou', city: 'Niamey', countryCode: 'NE', kind: 'law', bio: 'Étudiante à Niamey. Passeport, visa, dossiers de bourse.' },
  { handle: 'nc16', firstName: 'Zalika', lastName: 'Chékou', city: 'Niamey', countryCode: 'NE', kind: 'tip', bio: 'Étudiante à Niamey. Concours, formations, préparer son départ.' },
  { handle: 'nc17', firstName: 'Djamila', lastName: 'Harouna', city: 'Niamey', countryCode: 'NE', kind: 'chat', bio: 'Enseignante à Niamey. La famille d’abord.' },
  { handle: 'nc18', firstName: 'Idrissa', lastName: 'Garba', city: 'Zinder', countryCode: 'NE', kind: 'chat', bio: 'Étudiant à Zinder. Haoussa, zarma, et beaucoup d’humour.' },
  { handle: 'nc19', firstName: 'Mahamadou', lastName: 'Kimba', city: 'Niamey', countryCode: 'NE', kind: 'tip', bio: 'Commerçant à Niamey. Attention aux agences qui promettent des visas.' },

  // ── Maroc (3) ──
  { handle: 'nc20', firstName: 'Maïmouna', lastName: 'Adamou', city: 'Meknès', countryCode: 'MA', kind: 'law', bio: 'Étudiante à Meknès. Carte de séjour et équivalences de diplômes.' },
  { handle: 'nc21', firstName: 'Amina', lastName: 'Yayé', city: 'Rabat', countryCode: 'MA', kind: 'tip', bio: 'Étudiante à Rabat. Bourse AMCI, logement, budget du mois.' },
  { handle: 'nc22', firstName: 'Issoufou', lastName: 'Gonda', city: 'Meknès', countryCode: 'MA', kind: 'chat', bio: 'Étudiant à Meknès. On s’entraide entre promos.' },

  // ── Amérique du Nord (2) ──
  { handle: 'nc23', firstName: 'Ramatou', lastName: 'Assoumane', city: 'Montréal', countryCode: 'CA', kind: 'law', bio: 'Infirmière à Montréal. Permis d’études, PGWP, preuves financières.' },
  { handle: 'nc24', firstName: 'Ali', lastName: 'Souley', city: 'New York', countryCode: 'US', kind: 'tip', bio: 'Informaticien à New York. Envoyer de l’argent sans se faire manger les frais.' },

  // ── Reste de la diaspora (1) ──
  { handle: 'nc25', firstName: 'Boubacar', lastName: 'Dodo', city: 'Bruxelles', countryCode: 'BE', kind: 'chat', bio: 'Technicien à Bruxelles. J’ai vécu dans trois pays, je compare.' },
] as const;
