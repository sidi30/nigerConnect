import { Alert } from 'react-native';
import { render, screen, fireEvent, within } from '@testing-library/react-native';
import {
  Badge,
  BadgeGroup,
  badgeLabel,
  selectPersonBadges,
  type BadgeKind,
} from '@/components/ui/Badge';

/**
 * Le système de badges (grammaire documentée en tête de Badge.tsx) : un
 * `kind` par pastille, un mécanisme de libellé unique, un ordre déterministe
 * quand deux badges coexistent sur la même entité.
 */

describe('selectPersonBadges — quel(s) badge(s) pour une personne', () => {
  it("n'affiche que l'officiel, jamais à côté d'un autre, quand le compte est officiel", () => {
    expect(
      selectPersonBadges({ isOfficial: true, identityStatus: 'approved', isAmbassador: true }),
    ).toEqual(['official']);
  });

  it('vérifié + ambassadeur coexistent, dans cet ordre (identité avant distinction)', () => {
    expect(selectPersonBadges({ identityStatus: 'approved', isAmbassador: true })).toEqual([
      'person_verified',
      'ambassador',
    ]);
  });

  it('vérifié seul', () => {
    expect(selectPersonBadges({ identityStatus: 'approved', isAmbassador: false })).toEqual([
      'person_verified',
    ]);
  });

  it('ambassadeur seul (identité non approuvée)', () => {
    expect(selectPersonBadges({ identityStatus: 'pending', isAmbassador: true })).toEqual([
      'ambassador',
    ]);
  });

  it('aucun badge quand rien ne s’applique', () => {
    expect(selectPersonBadges({ identityStatus: 'none', isAmbassador: false })).toEqual([]);
  });
});

describe('badgeLabel — le libellé qui porte le sens, pas la couleur', () => {
  it('association vérifiée sans date : titre seul', () => {
    const l = badgeLabel('association_verified');
    expect(l.title).toBe('Association vérifiée');
    expect(l.body).toBeUndefined();
  });

  it('association vérifiée avec date : la date apparaît dans le corps du libellé', () => {
    const l = badgeLabel('association_verified', { verifiedAt: '2026-03-14T00:00:00.000Z' });
    expect(l.body).toMatch(/Vérifiée le .*2026/);
    expect(l.a11y).toContain(l.body);
  });

  it('réalisation de confiance : le décompte d’avis apparaît quand fourni', () => {
    const l = badgeLabel('realisation_trusted', { trustedCount: 12 });
    expect(l.body).toBe('12 avis vérifiés.');
  });

  it('réalisation de confiance sans décompte : un corps générique, jamais vide', () => {
    const l = badgeLabel('realisation_trusted');
    expect(l.body).toBeTruthy();
  });

  // Chaque kind doit avoir un titre distinct — sinon deux badges différents
  // se resemblent au tap, ce que la grammaire interdit explicitement.
  it('les six kinds ont un titre distinct', () => {
    const kinds: BadgeKind[] = [
      'official',
      'person_verified',
      'ambassador',
      'association_verified',
      'realisation_id_verified',
      'realisation_trusted',
    ];
    const titles = kinds.map((k) => badgeLabel(k).title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('<Badge> — rendu et libellé au tap', () => {
  let alertSpy: jest.SpiedFunction<typeof Alert.alert>;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('le badge personne (vert, disque) ne déclenche rien au tap — comportement inchangé', () => {
    render(<Badge kind="person_verified" />);
    const node = screen.getByTestId('badge-person_verified');
    fireEvent.press(node);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("le badge association affiche un libellé explicite au tap", () => {
    render(<Badge kind="association_verified" verifiedAt="2026-01-05T00:00:00.000Z" />);
    fireEvent.press(screen.getByTestId('badge-association_verified'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, body] = alertSpy.mock.calls[0]!;
    expect(title).toBe('Association vérifiée');
    expect(body).toMatch(/Vérifiée le/);
  });

  it("interactive={false} rend le badge silencieux même pour un kind tappable par défaut", () => {
    render(<Badge kind="association_verified" interactive={false} />);
    fireEvent.press(screen.getByTestId('badge-association_verified'));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('interactive={true} force le tap même pour un kind non-tappable par défaut', () => {
    render(<Badge kind="ambassador" interactive />);
    fireEvent.press(screen.getByTestId('badge-ambassador'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});

describe('<BadgeGroup> — coexistence de deux badges', () => {
  it('rend vérifié ET ambassadeur, dans l’ordre déterministe (vérifié avant ambassadeur)', () => {
    render(<BadgeGroup kinds={['ambassador', 'person_verified']} />);
    const group = screen.getByTestId('badge-group');
    const rendered = within(group).getAllByTestId(/^badge-(?!group)/);
    expect(rendered.map((n) => n.props.testID)).toEqual(['badge-person_verified', 'badge-ambassador']);
  });

  it('une réalisation peut porter ses deux badges à la fois, id-vérifiée avant confiance', () => {
    render(<BadgeGroup kinds={['realisation_trusted', 'realisation_id_verified']} />);
    const group = screen.getByTestId('badge-group');
    const rendered = within(group).getAllByTestId(/^badge-(?!group)/);
    expect(rendered.map((n) => n.props.testID)).toEqual([
      'badge-realisation_id_verified',
      'badge-realisation_trusted',
    ]);
  });

  it("ne rend rien du tout quand la liste de kinds est vide (pas de View fantôme)", () => {
    render(<BadgeGroup kinds={[]} />);
    expect(screen.queryByTestId('badge-group')).toBeNull();
  });

  it('replie l’excédent dans une puce "+N" plutôt que de laisser déborder la ligne', () => {
    render(
      <BadgeGroup
        kinds={['official', 'person_verified', 'association_verified', 'ambassador']}
        max={2}
      />,
    );
    const group = screen.getByTestId('badge-group');
    const rendered = within(group).getAllByTestId(/^badge-(?!group)/);
    // 2 badges visibles + 1 puce de débordement, jamais un rendu silencieusement tronqué sans indice.
    expect(rendered).toHaveLength(3);
    expect(screen.getByTestId('badge-overflow')).toBeTruthy();
  });

  it('la puce de débordement affiche le bon compte et son libellé au tap liste les badges cachés', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(
      <BadgeGroup
        kinds={['official', 'person_verified', 'association_verified', 'ambassador']}
        max={2}
      />,
    );
    expect(screen.getByText('+2')).toBeTruthy();
    fireEvent.press(screen.getByTestId('badge-overflow'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });
});
