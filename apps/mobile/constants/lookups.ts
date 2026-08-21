// Pure lookup tables + presentation helpers. No fake data.

export const SERVICE_CATEGORY_LABELS: Record<string, string> = {
  logement: '🏠 Logement',
  transport: '✈️ Transport',
  admin_category: '📋 Admin',
  sante: '🏥 Santé',
  emploi: '💼 Emploi',
  business: '💰 Business',
  education: '🎓 Éducation',
  autre: '📦 Autre',
};

export const SERVICE_CATEGORIES = Object.keys(SERVICE_CATEGORY_LABELS);

export const COMMUNITY_PRICE_TYPE_LABELS: Record<string, string> = {
  billet_avion: '✈️ Billet d’avion',
  transfert_argent: '💸 Transfert d’argent',
  colis_kg: '📦 Colis (kg)',
};

export const ASSOCIATION_CATEGORY_LABELS: Record<string, string> = {
  generaliste: '🏛️ Généraliste',
  etudiants: '🎓 Étudiants',
  femmes: '👩 Femmes',
  jeunesse: '🧒 Jeunesse',
  culture: '🎭 Culture',
  business: '💼 Business',
  sport: '⚽ Sport',
  religieux: '🕌 Religieux',
};

// A4 — titres du bureau exécutif d'une association. 'other' n'a pas de
// libellé fixe : afficher `officer.customTitle` à la place (voir
// officerTitleLabel ci-dessous).
export const ASSOCIATION_OFFICER_TITLE_LABELS: Record<string, string> = {
  president: 'Président(e)',
  vice_president: 'Vice-président(e)',
  secretary: 'Secrétaire',
  treasurer: 'Trésorier(ère)',
  spokesperson: 'Porte-parole',
  other: 'Autre',
};

/** Titre à afficher pour un membre du bureau : le libellé fixe, ou le titre libre pour 'other'. */
export function officerTitleLabel(officer: { title: string; customTitle: string | null }): string {
  if (officer.title === 'other') return officer.customTitle ?? 'Membre du bureau';
  return ASSOCIATION_OFFICER_TITLE_LABELS[officer.title] ?? officer.title;
}

interface OfficerSeatLike {
  sortOrder: number;
  acceptedAt: string | null | undefined;
}

/**
 * Which officer seats the bureau screen renders, in what order.
 *
 * Mirrors the API's own invariant on purpose (association.service.ts
 * `listOfficers`: `acceptedAt: { not: null }`, `orderBy: [{ sortOrder: 'asc' }, …]`) —
 * the API is the only place that should ever produce a pending seat here,
 * but for a volunteer association's public leadership list, silently
 * rendering someone who never accepted as if they'd agreed to sit on the
 * board is a real trust problem, not a cosmetic one. Filtering + sorting
 * again client-side costs nothing and makes "only accepted seats, in
 * sortOrder" a guarantee this app owns, instead of a hope about the API.
 */
export function visibleOfficers<T extends OfficerSeatLike>(officers: T[]): T[] {
  return officers
    .filter((o) => !!o.acceptedAt)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

interface OfficerInviteNotificationLike {
  type: string;
  data: unknown;
}

/**
 * Whether the "on te propose une place au bureau" accept/decline banner
 * should show. Extracted out of app/associations/[id].tsx so the rule — the
 * banner needs a matching pending-invite notification for THIS association,
 * the viewer must not already be an officer, and it hides for good once the
 * viewer has acted this session — is provable without rendering the screen.
 */
export function selectOfficerInviteBanner(params: {
  notifications: OfficerInviteNotificationLike[];
  associationId: string | undefined;
  alreadyOfficer: boolean;
  actionTaken: boolean;
}): boolean {
  const { notifications, associationId, alreadyOfficer, actionTaken } = params;
  if (!associationId || alreadyOfficer || actionTaken) return false;
  return notifications.some((n) => {
    if (n.type !== 'association_officer_invite') return false;
    const data = n.data as { associationId?: string } | null;
    return data?.associationId === associationId;
  });
}

const PALETTE = ['#E05206', '#FF6D00', '#0DB02B', '#1565C0', '#7B1FA2', '#E8833A'];

export function colorForId(id: string | undefined | null): string {
  if (!id) return PALETTE[0]!;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

export function relativeTime(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}j`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}sem`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
