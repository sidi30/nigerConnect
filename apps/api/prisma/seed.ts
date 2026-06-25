import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const CITIES = [
  { city: 'Niamey', countryCode: 'NE', lat: 13.5116, lon: 2.1254 },
  { city: 'Paris', countryCode: 'FR', lat: 48.8566, lon: 2.3522 },
  { city: 'Lyon', countryCode: 'FR', lat: 45.7640, lon: 4.8357 },
  { city: 'Marseille', countryCode: 'FR', lat: 43.2965, lon: 5.3698 },
  { city: 'Montréal', countryCode: 'CA', lat: 45.5017, lon: -73.5673 },
  { city: 'Dakar', countryCode: 'SN', lat: 14.7167, lon: -17.4677 },
  { city: 'Bruxelles', countryCode: 'BE', lat: 50.8503, lon: 4.3517 },
  { city: 'New York', countryCode: 'US', lat: 40.7128, lon: -74.006 },
  { city: 'Casablanca', countryCode: 'MA', lat: 33.5731, lon: -7.5898 },
  { city: 'Istanbul', countryCode: 'TR', lat: 41.0082, lon: 28.9784 },
];

const FIRST_NAMES = ['Aïcha', 'Ibrahim', 'Fatima', 'Oumarou', 'Hadiza', 'Moussa', 'Mariama', 'Souley', 'Zara', 'Alassane', 'Aminata', 'Issouf', 'Ramatou', 'Balkissa', 'Nafissa', 'Halima'];
const LAST_NAMES = ['Maïga', 'Diallo', 'Hassan', 'Issa', 'Soumana', 'Boubacar', 'Yacouba', 'Zakari', 'Amadou', 'Moumouni', 'Sani', 'Garba', 'Waziri'];

const BIOS = [
  'Ingénieur IT • Passionné de culture nigérienne',
  'Juriste • Bénévole ANF',
  'Étudiant en médecine',
  'Entrepreneure • Mode africaine',
  'Comptable',
  'Infirmière • Bénévole',
  'Doctorante en chimie',
  'Responsable associative',
  'Finance • Business',
  'Import/Export',
  'Étudiante MBA',
  'Commerçant',
  'Enseignante',
  'Analyste data • Tech',
  'Diplomate • ONG',
];

const POSTS_CONTENT = [
  { content: 'Magnifique soirée culturelle nigérienne ! Musique, danse et dégustations 🎶🇳🇪', visibility: 'public' as const },
  { content: 'Ma nouvelle collection de mode africaine est disponible ! Tissus wax authentiques du Niger 👗✨', visibility: 'friends' as const },
  { content: "Besoin d'un traducteur pour mes documents universitaires. Si quelqu'un connaît, merci 🙏", visibility: 'public' as const },
  { content: '200 kits scolaires distribués aux enfants nigériens ! Solidarité de la diaspora 💪🇳🇪', visibility: 'public' as const },
  { content: '📢 Opportunité business : partenaires nigériens pour import/export textile. Conditions intéressantes.', visibility: 'public' as const },
  { content: 'Bienvenue aux nouveaux étudiants nigériens arrivés à Montréal ! On vous accompagne 🇨🇦🇳🇪', visibility: 'friends' as const },
  { content: 'Le Tchoukou nigérien fait sensation ! Notre gastronomie conquiert 🧀🔥', visibility: 'public' as const },
  { content: "Merci à tous ceux qui étaient présents à l'événement d'hier 💛", visibility: 'friends' as const },
  { content: "Quelqu'un sait où trouver de la semoule de mil ?", visibility: 'public' as const },
  { content: 'Nouveau projet associatif en préparation, avis aux bonnes volontés !', visibility: 'public' as const },
];

function pravatarUrl(id: number): string {
  return `https://i.pravatar.cc/160?img=${id}`;
}
function picsumUrl(seed: string, w = 600, h = 400): string {
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

async function main(): Promise<void> {
  console.log('🌱 Seeding database...');
  const password = await argon2.hash('Seed!Password99', { type: argon2.argon2id });

  const users = [];
  for (let i = 0; i < 20; i++) {
    const loc = CITIES[i % CITIES.length]!;
    const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const last = LAST_NAMES[i % LAST_NAMES.length]!;
    const email = `seed.user${i}@nigerconnect.local`;
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        passwordHash: password,
        firstName: first,
        lastName: last,
        displayName: `${first} ${last}`,
        bio: BIOS[i % BIOS.length],
        avatarUrl: pravatarUrl((i + 1) * 3),
        city: loc.city,
        countryCode: loc.countryCode,
        latitude: loc.lat + (Math.random() - 0.5) * 0.05,
        longitude: loc.lon + (Math.random() - 0.5) * 0.05,
        identityStatus: i < 14 ? 'approved' : 'not_submitted',
        privacyLevel: 'public',
      },
      update: {
        avatarUrl: pravatarUrl((i + 1) * 3),
        bio: BIOS[i % BIOS.length],
        latitude: loc.lat + (Math.random() - 0.5) * 0.05,
        longitude: loc.lon + (Math.random() - 0.5) * 0.05,
        privacyLevel: 'public',
        identityStatus: i < 14 ? 'approved' : 'not_submitted',
      },
    });
    users.push(user);
  }
  console.log(`  · ${users.length} users`);

  const [u0, u1, u2, u3, u4, u5, u6, u7, u8] = users;
  if (!u0 || !u1 || !u2 || !u3 || !u4 || !u5 || !u6 || !u7 || !u8) throw new Error('seed failed');

  // Clean existing dynamic data so seed is idempotent
  await prisma.message.deleteMany({ where: { sender: { email: { startsWith: 'seed.' } } } });
  await prisma.conversation.deleteMany({
    where: { members: { some: { user: { email: { startsWith: 'seed.' } } } } },
  });
  await prisma.post.deleteMany({ where: { author: { email: { startsWith: 'seed.' } } } });
  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requester: { email: { startsWith: 'seed.' } } },
        { addressee: { email: { startsWith: 'seed.' } } },
      ],
    },
  });
  await prisma.serviceRequest.deleteMany({
    where: { author: { email: { startsWith: 'seed.' } } },
  });

  // Friendships accepted
  const acceptedPairs: Array<[string, string]> = [
    [u0.id, u1.id],
    [u0.id, u2.id],
    [u0.id, u3.id],
    [u0.id, u4.id],
    [u0.id, u5.id],
    [u1.id, u3.id],
    [u2.id, u4.id],
    [u6.id, u7.id],
  ];
  for (const [a, b] of acceptedPairs) {
    await prisma.friendship.create({
      data: { requesterId: a, addresseeId: b, status: 'accepted' },
    });
  }
  console.log(`  · ${acceptedPairs.length} friendships accepted`);

  // Pending friend requests to u0
  const pendingRequesters = [u6.id, u7.id, u8.id];
  for (const requesterId of pendingRequesters) {
    await prisma.friendship.create({
      data: { requesterId, addresseeId: u0.id, status: 'pending' },
    });
  }
  console.log(`  · ${pendingRequesters.length} pending friend requests for u0`);

  // Posts
  for (let i = 0; i < POSTS_CONTENT.length; i++) {
    const author = users[i % users.length]!;
    const tmpl = POSTS_CONTENT[i]!;
    const hasMedia = i % 2 === 0;
    await prisma.post.create({
      data: {
        authorId: author.id,
        content: tmpl.content,
        visibility: tmpl.visibility,
        createdAt: new Date(Date.now() - i * 3600_000),
        media: hasMedia
          ? {
              create: [
                { mediaUrl: picsumUrl(`post${i}a`, 800, 600), mediaType: 'image', sortOrder: 0 },
                ...(i % 4 === 0
                  ? [
                      {
                        mediaUrl: picsumUrl(`post${i}b`, 800, 600),
                        mediaType: 'image' as const,
                        sortOrder: 1,
                      },
                    ]
                  : []),
              ],
            }
          : undefined,
      },
    });
  }
  console.log(`  · ${POSTS_CONTENT.length} posts`);

  // Stories
  const storyAuthors = [u1, u2, u3, u4, u5];
  for (let i = 0; i < storyAuthors.length; i++) {
    const author = storyAuthors[i]!;
    await prisma.post.create({
      data: {
        authorId: author.id,
        visibility: 'friends',
        isStory: true,
        storyExpiresAt: new Date(Date.now() + (20 - i) * 3600_000),
        createdAt: new Date(Date.now() - i * 600_000),
        media: {
          create: {
            mediaUrl: picsumUrl(`story${i}`, 400, 700),
            mediaType: 'image',
            sortOrder: 0,
          },
        },
      },
    });
  }
  console.log(`  · ${storyAuthors.length} stories`);

  // Conversation u0 <-> u1
  const convo1 = await prisma.conversation.create({
    data: {
      type: 'direct',
      createdById: u0.id,
      members: {
        create: [
          { userId: u0.id, role: 'admin', unreadCount: 2 },
          { userId: u1.id, role: 'member' },
        ],
      },
    },
  });
  const exchanges1 = [
    { from: u1.id, text: 'Salut Aïcha ! Comment vas-tu ?' },
    { from: u0.id, text: 'Ça va bien merci 😊 Et toi ?' },
    { from: u1.id, text: 'Super ! Tu viens à la réunion ANF samedi ?' },
    { from: u0.id, text: 'Oui bien sûr ! À quelle heure déjà ?' },
    { from: u1.id, text: "Super ! On se voit samedi alors pour la réunion de l'ANF 👍" },
  ];
  let t = new Date(Date.now() - 3600_000);
  for (const m of exchanges1) {
    t = new Date(t.getTime() + 120_000);
    await prisma.message.create({
      data: { conversationId: convo1.id, senderId: m.from, content: m.text, createdAt: t },
    });
  }
  await prisma.conversation.update({
    where: { id: convo1.id },
    data: { lastMessageAt: t, lastMessagePreview: exchanges1[exchanges1.length - 1]!.text },
  });

  // u0 <-> u2
  const convo2 = await prisma.conversation.create({
    data: {
      type: 'direct',
      createdById: u0.id,
      members: {
        create: [
          { userId: u0.id, role: 'admin' },
          { userId: u2.id, role: 'member' },
        ],
      },
    },
  });
  const m2 = await prisma.message.create({
    data: {
      conversationId: convo2.id,
      senderId: u2.id,
      content: 'Les kits scolaires sont arrivés, merci pour ton aide !',
    },
  });
  await prisma.conversation.update({
    where: { id: convo2.id },
    data: { lastMessageAt: m2.createdAt, lastMessagePreview: m2.content },
  });

  // u0 <-> u3 (unread 1 for u0)
  const convo3 = await prisma.conversation.create({
    data: {
      type: 'direct',
      createdById: u3.id,
      members: {
        create: [
          { userId: u0.id, role: 'member', unreadCount: 1 },
          { userId: u3.id, role: 'admin' },
        ],
      },
    },
  });
  const m3 = await prisma.message.create({
    data: {
      conversationId: convo3.id,
      senderId: u3.id,
      content: "Je t'envoie les photos de la collection demain",
    },
  });
  await prisma.conversation.update({
    where: { id: convo3.id },
    data: { lastMessageAt: m3.createdAt, lastMessagePreview: m3.content },
  });
  console.log('  · 3 conversations with messages');

  // Service requests
  const services: Array<{
    author: typeof u0;
    title: string;
    category:
      | 'logement'
      | 'transport'
      | 'admin_category'
      | 'sante'
      | 'emploi'
      | 'business'
      | 'education'
      | 'autre';
    urgency: 'urgent' | 'normal';
    description: string;
    budget?: string;
    city?: string;
    countryCode?: string;
  }> = [
    {
      author: u3,
      title: 'Cherche logement temporaire à Marseille',
      category: 'logement',
      urgency: 'urgent',
      description: "Arrivée prévue le 15 février. Besoin d'un studio ou chambre pour 2 mois.",
      budget: '500-700€/mois',
      city: 'Marseille',
      countryCode: 'FR',
    },
    {
      author: u5,
      title: 'Envoi groupé de colis vers Niamey',
      category: 'transport',
      urgency: 'normal',
      description: 'Départ prévu fin janvier. On regroupe les colis pour réduire les frais.',
      budget: '15€/kg',
      city: 'Paris',
      countryCode: 'FR',
    },
    {
      author: u7,
      title: 'Traducteur turc-français pour dossier',
      category: 'admin_category',
      urgency: 'normal',
      description: "Besoin de traduire des documents pour l'équivalence de diplôme.",
      budget: 'À discuter',
      city: 'Istanbul',
      countryCode: 'TR',
    },
    {
      author: u4,
      title: 'Médecin nigérien à Lille ?',
      category: 'sante',
      urgency: 'urgent',
      description: 'Recherche un médecin parlant haoussa ou zarma.',
      countryCode: 'FR',
    },
    {
      author: u6,
      title: 'Développeur React pour projet diaspora',
      category: 'emploi',
      urgency: 'normal',
      description: 'On recrute un dev front pour une app communautaire. Remote OK.',
      budget: '45-55K€',
      countryCode: 'FR',
    },
    {
      author: u8,
      title: 'Partenaire import parfums depuis Dubaï',
      category: 'business',
      urgency: 'normal',
      description: "Cherche distributeur en France ou Afrique de l'Ouest.",
      countryCode: 'AE',
    },
  ];
  for (const s of services) {
    await prisma.serviceRequest.create({
      data: {
        authorId: s.author.id,
        title: s.title,
        description: s.description,
        category: s.category,
        urgency: s.urgency,
        budget: s.budget ?? null,
        city: s.city ?? null,
        countryCode: s.countryCode ?? null,
        status: 'open',
      },
    });
  }
  console.log(`  · ${services.length} service requests`);

  // Associations (idempotent)
  const existingAssocs = await prisma.association.count();
  if (existingAssocs < 5) {
    const assocs: Array<{
      name: string;
      category: 'generaliste' | 'etudiants' | 'femmes' | 'jeunesse' | 'business';
      city: string;
      countryCode: string;
    }> = [
      { name: 'Nigériens de Paris', category: 'generaliste', city: 'Paris', countryCode: 'FR' },
      { name: 'Étudiants Nigériens de Montréal', category: 'etudiants', city: 'Montréal', countryCode: 'CA' },
      { name: 'Femmes Nigériennes en Diaspora', category: 'femmes', city: 'Bruxelles', countryCode: 'BE' },
      { name: 'Jeunesse Niger Belgique', category: 'jeunesse', city: 'Bruxelles', countryCode: 'BE' },
      { name: 'Business Club NE-US', category: 'business', city: 'New York', countryCode: 'US' },
    ];
    for (const a of assocs) {
      await prisma.association.create({
        data: {
          name: a.name,
          description: `${a.name} — communauté active.`,
          category: a.category,
          city: a.city,
          countryCode: a.countryCode,
          isVerified: true,
          createdById: u0.id,
          memberCount: 1,
          members: { create: { userId: u0.id, role: 'admin', status: 'approved' } },
        },
      });
    }
    console.log('  · 5 associations');
  }

  // ── AppSettings (parrainage §10.1) ───────────────────────────────
  // Seeds with 'open' so deploy never locks anyone out.
  // Flip to 'invite_only' from admin UI once root invitations are generated.
  const settings: Array<{ key: string; value: string }> = [
    { key: 'registration_mode', value: 'open' },
    { key: 'default_invite_quota', value: '3' },
    { key: 'invite_expiry_days', value: '30' },
  ];
  for (const s of settings) {
    await prisma.appSetting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value },
      update: {}, // never overwrite an admin-set value during re-seeding
    });
  }
  console.log('  · app_settings seeded (registration_mode=open)');

  console.log('✓ Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
