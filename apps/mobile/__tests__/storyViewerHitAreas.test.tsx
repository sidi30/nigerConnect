import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import StoryViewerScreen from '@/app/stories/[authorId]';
import { feedApi } from '@/services/feedApi';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ authorId: 'me-1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock('@/services/feedApi', () => ({
  feedApi: { stories: jest.fn(), deleteStory: jest.fn() },
}));

// Le store d'auth tire la couche axios (adaptateur fetch incompatible avec
// l'environnement jest d'Expo) : on ne garde que l'identité, seule utile ici.
jest.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: 'me-1' } }),
}));

// Le lecteur vidéo tire sur expo-video : hors sujet ici (story photo).
jest.mock('@/components/feed/StoryVideoPlayer', () => ({ StoryVideoPlayer: () => null }));

const AUTHOR = {
  id: 'me-1',
  displayName: 'Moi',
  firstName: 'Moi',
  lastName: null,
  avatarUrl: null,
  city: null,
  countryCode: 'NE',
  identityStatus: 'NONE',
  isAmbassador: false,
  ratingAvg: 0,
  ratingCount: 0,
};

const STORY = {
  id: 'story-1',
  createdAt: new Date().toISOString(),
  media: [{ mediaUrl: 'https://cdn.test/photo.jpg', mediaType: 'image', thumbnailUrl: null }],
};

function renderViewer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 393, height: 852 },
        // iPhone 15 Pro : c'est cet inset (59) qui faisait passer l'entête sous
        // l'ancienne zone de tap codée en dur à 80.
        insets: { top: 59, left: 0, right: 0, bottom: 34 },
      }}
    >
      <QueryClientProvider client={qc}>
        <StoryViewerScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

describe('Story viewer — zones de tap vs entête', () => {
  beforeEach(() => {
    (feedApi.stories as jest.Mock).mockResolvedValue([{ author: AUTHOR, stories: [STORY] }]);
  });

  it('démarre les zones de tap sous l\'entête réellement mesurée', async () => {
    renderViewer();
    const header = await screen.findByTestId('story-header');

    // Entête plus haute que l'ancien seuil figé de 80 px (encoche + progression
    // + ligne auteur) : c'est le cas qui rendait la corbeille intouchable.
    const measuredH = 128;
    fireEvent(header, 'layout', { nativeEvent: { layout: { height: measuredH } } });

    for (const id of ['story-tap-prev', 'story-tap-next']) {
      const zone = screen.getByTestId(id);
      const style = Array.isArray(zone.props.style)
        ? Object.assign({}, ...zone.props.style.filter(Boolean))
        : zone.props.style;
      expect(style.top).toBe(measuredH);
    }
  });

  it('laisse la corbeille et la ✕ hors des zones de tap dès le premier rendu', async () => {
    renderViewer();
    // Avant toute mesure, le repli doit déjà dépasser la hauteur d'entête d'un
    // téléphone à encoche — sinon la 1re frame réintroduit le bug.
    const zone = await screen.findByTestId('story-tap-next');
    const style = Array.isArray(zone.props.style)
      ? Object.assign({}, ...zone.props.style.filter(Boolean))
      : zone.props.style;
    expect(style.top).toBeGreaterThanOrEqual(59 + 60);
    expect(await screen.findByLabelText('Supprimer cette story')).toBeTruthy();
  });
});
