"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const argon2_1 = __importDefault(require("argon2"));
const prisma = new client_1.PrismaClient();
const CITIES = [
    { city: 'Niamey', countryCode: 'NE', lat: 13.5116, lon: 2.1254 },
    { city: 'Paris', countryCode: 'FR', lat: 48.8566, lon: 2.3522 },
    { city: 'Montréal', countryCode: 'CA', lat: 45.5017, lon: -73.5673 },
    { city: 'Dakar', countryCode: 'SN', lat: 14.7167, lon: -17.4677 },
    { city: 'Bruxelles', countryCode: 'BE', lat: 50.8503, lon: 4.3517 },
    { city: 'New York', countryCode: 'US', lat: 40.7128, lon: -74.006 },
];
const FIRST_NAMES = ['Aïcha', 'Ibrahim', 'Fatima', 'Oumarou', 'Hadiza', 'Moussa', 'Mariama', 'Souley', 'Zara', 'Alassane'];
const LAST_NAMES = ['Maïga', 'Diallo', 'Hassan', 'Issa', 'Soumana', 'Boubacar', 'Yacouba', 'Zakari', 'Amadou', 'Moumouni'];
async function main() {
    console.log('🌱 Seeding database...');
    const password = await argon2_1.default.hash('Seed!Password99', { type: argon2_1.default.argon2id });
    const users = [];
    for (let i = 0; i < 20; i++) {
        const loc = CITIES[i % CITIES.length];
        const first = FIRST_NAMES[i % FIRST_NAMES.length];
        const last = LAST_NAMES[i % LAST_NAMES.length];
        const email = `seed.user${i}@nigerconnect.local`;
        const user = await prisma.user.upsert({
            where: { email },
            create: {
                email,
                passwordHash: password,
                firstName: first,
                lastName: last,
                displayName: `${first} ${last}`,
                bio: `Membre de la diaspora nigérienne à ${loc.city}.`,
                city: loc.city,
                countryCode: loc.countryCode,
                latitude: loc.lat + (Math.random() - 0.5) * 0.05,
                longitude: loc.lon + (Math.random() - 0.5) * 0.05,
                identityStatus: i < 10 ? 'approved' : 'not_submitted',
            },
            update: {},
        });
        users.push(user);
    }
    const [u0, u1, u2, u3, u4] = users;
    // Friendships
    const pairs = [
        [u0.id, u1.id],
        [u0.id, u2.id],
        [u1.id, u3.id],
        [u2.id, u4.id],
    ];
    for (const [a, b] of pairs) {
        await prisma.friendship.upsert({
            where: { requesterId_addresseeId: { requesterId: a, addresseeId: b } },
            create: { requesterId: a, addresseeId: b, status: 'accepted' },
            update: { status: 'accepted' },
        });
    }
    // Posts
    const existingPosts = await prisma.post.count();
    if (existingPosts < 20) {
        for (let i = 0; i < 20; i++) {
            const author = users[i % users.length];
            await prisma.post.create({
                data: {
                    authorId: author.id,
                    content: i % 3 === 0
                        ? `Bonjour à tous depuis ${author.city} ! 👋`
                        : i % 3 === 1
                            ? 'Quelqu\'un connaît un bon restaurant nigérien près de chez moi ?'
                            : 'Très belle fête des associations nigériennes hier. Merci à tous !',
                    visibility: i % 4 === 0 ? 'public' : 'friends',
                },
            });
        }
    }
    // Associations
    const existingAssocs = await prisma.association.count();
    if (existingAssocs < 5) {
        const assocs = [
            { name: 'Nigériens de Paris', category: 'generaliste', city: 'Paris', countryCode: 'FR' },
            { name: 'Étudiants Nigériens de Montréal', category: 'etudiants', city: 'Montréal', countryCode: 'CA' },
            { name: 'Femmes Nigériennes en Diaspora', category: 'femmes', city: 'Bruxelles', countryCode: 'BE' },
            { name: 'Jeunesse Niger Belgique', category: 'jeunesse', city: 'Bruxelles', countryCode: 'BE' },
            { name: 'Business Club NE-US', category: 'business', city: 'New York', countryCode: 'US' },
        ];
        for (const a of assocs) {
            const assoc = await prisma.association.create({
                data: {
                    name: a.name,
                    description: `${a.name} — communauté active depuis 2024.`,
                    category: a.category,
                    city: a.city,
                    countryCode: a.countryCode,
                    isVerified: true,
                    createdById: u0.id,
                    memberCount: 1,
                    members: {
                        create: { userId: u0.id, role: 'admin', status: 'approved' },
                    },
                },
            });
            console.log(`  · Association: ${assoc.name}`);
        }
    }
    console.log(`✓ Seeded ${users.length} users, ${pairs.length} friendships, ~20 posts, ~5 associations`);
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(() => void prisma.$disconnect());
//# sourceMappingURL=seed.js.map