/**
 * Seed two reviewer accounts in production so Google Play / App Store reviewers
 * can evaluate every feature without going through the full signup flow.
 *
 * Idempotent: running it twice does not duplicate data — it upserts the users
 * and only inserts friends/posts/conversations the first time.
 *
 * Usage in production:
 *   docker exec -i nigerconnect-api node -e "require('./dist/scripts/seed-reviewer').run()"
 *
 * Or in dev:
 *   pnpm --filter @nigerconnect/api exec ts-node --transpile-only scripts/seed-reviewer.ts
 *
 * Credentials matched against `docs/STORE_SUBMISSION.md` §6 — keep them in sync.
 */
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const REVIEWER_EMAIL = 'reviewer@nigerconnect.ne';
const REVIEWER_PASSWORD = 'ReviewPlay2026!';
const DELETION_REVIEWER_EMAIL = 'reviewer-deletion@nigerconnect.ne';
const DELETION_REVIEWER_PASSWORD = 'DeletePlay2026!';

const FAKE_FRIENDS = [
  {
    email: 'review-friend-aminata@nigerconnect.test',
    firstName: 'Aminata',
    lastName: 'Hassane',
    displayName: 'Aminata H.',
    city: 'Niamey',
    countryCode: 'NE',
    bio: 'Étudiante en médecine, fan de tchadi 🍵',
  },
  {
    email: 'review-friend-ousmane@nigerconnect.test',
    firstName: 'Ousmane',
    lastName: 'Saley',
    displayName: 'Ousmane S.',
    city: 'Paris',
    countryCode: 'FR',
    bio: 'Ingénieur réseau · Niamey ↔ Paris',
  },
  {
    email: 'review-friend-fatima@nigerconnect.test',
    firstName: 'Fatima',
    lastName: 'Maïga',
    displayName: 'Fatima M.',
    city: 'Montréal',
    countryCode: 'CA',
    bio: 'Sage-femme. Toujours dispo pour aider la diaspora ✨',
  },
];

const FAKE_POSTS: Array<{ content: string; visibility: 'public' | 'friends' }> = [
  {
    content:
      "Bienvenue sur NigerConnect 🇳🇪 ! Cette première version réunit la diaspora dans 15+ pays. Hâte de voir la communauté grandir.",
    visibility: 'public',
  },
  {
    content:
      "Petit retour de mon dernier passage à Niamey : la place du Petit Marché grouille autant que jamais. Si vous y êtes en ce moment, vibes 💛",
    visibility: 'public',
  },
  {
    content:
      "Quelqu'un connaît un avocat spécialisé en droit du travail entre la France et le Niger ? Conseils bienvenus 🙏",
    visibility: 'friends',
  },
  {
    content:
      "Soirée associative samedi à Paris 19e : musique haoussa, foura, retrouvailles. DM si tu veux le lien d'inscription.",
    visibility: 'friends',
  },
  {
    content:
      "Mini-rappel : pour la vérification d'identité dans l'app, le doc est chiffré et supprimé 30j après validation. Pas de panique 🔐",
    visibility: 'public',
  },
];

async function upsertUser(args: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  city?: string;
  countryCode?: string;
  bio?: string;
  emailVerified?: boolean;
}) {
  const passwordHash = await argon2.hash(args.password);
  return prisma.user.upsert({
    where: { email: args.email },
    update: {
      passwordHash,
      firstName: args.firstName,
      lastName: args.lastName,
      displayName: args.displayName ?? `${args.firstName} ${args.lastName}`.trim(),
      city: args.city,
      countryCode: args.countryCode,
      bio: args.bio,
      emailVerified: args.emailVerified ?? true,
      status: 'active',
    },
    create: {
      email: args.email,
      passwordHash,
      firstName: args.firstName,
      lastName: args.lastName,
      displayName: args.displayName ?? `${args.firstName} ${args.lastName}`.trim(),
      city: args.city ?? null,
      countryCode: args.countryCode ?? null,
      bio: args.bio ?? null,
      emailVerified: args.emailVerified ?? true,
      privacyLevel: 'friends',
      status: 'active',
      role: 'user',
    },
  });
}

export async function run(): Promise<void> {
  console.log('Seeding reviewer accounts…');

  // Main reviewer (gets fake friends + posts + conversations).
  const reviewer = await upsertUser({
    email: REVIEWER_EMAIL,
    password: REVIEWER_PASSWORD,
    firstName: 'Reviewer',
    lastName: 'Play',
    displayName: 'Reviewer Play',
    city: 'Niamey',
    countryCode: 'NE',
    bio: 'Compte de test pour la review des stores.',
  });
  console.log(`  ✓ ${REVIEWER_EMAIL}`);

  // Deletion reviewer — used to test the account deletion flow. Gets a clean
  // slate every time so the deletion test isn't blocked by leftover state.
  const delReviewer = await upsertUser({
    email: DELETION_REVIEWER_EMAIL,
    password: DELETION_REVIEWER_PASSWORD,
    firstName: 'Reviewer',
    lastName: 'Deletion',
    displayName: 'Reviewer Deletion',
    bio: 'Compte test suppression — recréé à chaque seed.',
  });
  console.log(`  ✓ ${DELETION_REVIEWER_EMAIL}`);

  // Fake friends, idempotent
  const friendUsers = await Promise.all(
    FAKE_FRIENDS.map((f) =>
      upsertUser({
        email: f.email,
        password: 'fake-friend-password-not-used',
        firstName: f.firstName,
        lastName: f.lastName,
        displayName: f.displayName,
        city: f.city,
        countryCode: f.countryCode,
        bio: f.bio,
      }),
    ),
  );

  // Friendship pairs (reviewer ↔ each fake friend)
  for (const friend of friendUsers) {
    await prisma.friendship.upsert({
      where: { requesterId_addresseeId: { requesterId: reviewer.id, addresseeId: friend.id } },
      update: { status: 'accepted' },
      create: { requesterId: reviewer.id, addresseeId: friend.id, status: 'accepted' },
    });
  }
  console.log(`  ✓ ${friendUsers.length} amis reliés`);

  // Posts authored by the reviewer (idempotent: skip if 5 posts already exist)
  const existingPostsCount = await prisma.post.count({ where: { authorId: reviewer.id } });
  if (existingPostsCount < FAKE_POSTS.length) {
    for (const p of FAKE_POSTS) {
      await prisma.post.create({
        data: { authorId: reviewer.id, content: p.content, visibility: p.visibility },
      });
    }
    console.log(`  ✓ ${FAKE_POSTS.length} posts créés`);
  } else {
    console.log(`  · ${existingPostsCount} posts déjà présents — skip`);
  }

  // One direct conversation reviewer ↔ first fake friend, with two messages
  const peer = friendUsers[0]!;
  const existingConvo = await prisma.conversation.findFirst({
    where: {
      type: 'direct',
      AND: [
        { members: { some: { userId: reviewer.id } } },
        { members: { some: { userId: peer.id } } },
      ],
    },
  });
  if (!existingConvo) {
    const convo = await prisma.conversation.create({
      data: {
        type: 'direct',
        createdById: reviewer.id,
        lastMessagePreview: 'Salut ! Tu es bien arrivé(e) à Niamey ?',
        lastMessageAt: new Date(),
        members: {
          create: [
            { userId: reviewer.id, role: 'admin' },
            { userId: peer.id, role: 'member' },
          ],
        },
      },
    });
    await prisma.message.createMany({
      data: [
        {
          conversationId: convo.id,
          senderId: peer.id,
          content: "Salut ! Bienvenue sur NigerConnect 👋",
          messageType: 'text',
        },
        {
          conversationId: convo.id,
          senderId: reviewer.id,
          content: 'Salut ! Tu es bien arrivé(e) à Niamey ?',
          messageType: 'text',
        },
      ],
    });
    console.log(`  ✓ 1 conversation seedée avec ${peer.displayName ?? peer.email}`);
  } else {
    console.log('  · conversation déjà présente — skip');
  }

  console.log('Done.');
}

if (require.main === module) {
  run()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
