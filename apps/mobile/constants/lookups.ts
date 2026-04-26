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
