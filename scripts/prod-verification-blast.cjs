/**
 * Prod bulk verification sender — runs INSIDE the nigerconnect-api container
 * against compiled dist (no ts-node in prod). Reuses the real EmailTokenService
 * (valid 24h single-use token) + MailerService (branded template, prod SMTP).
 *
 *   docker cp scripts/prod-verification-blast.cjs nigerconnect-api:/tmp/blast.cjs
 *   docker exec -w /app nigerconnect-api node /tmp/blast.cjs            # dry-run
 *   docker exec -w /app nigerconnect-api node /tmp/blast.cjs --send     # live
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('/app/dist/app.module');
const { PrismaService } = require('/app/dist/common/prisma/prisma.service');
const { EmailTokenService } = require('/app/dist/auth/email-token.service');
const { MailerService } = require('/app/dist/common/mail/mailer.service');

const SEND = process.argv.includes('--send');
const THROTTLE_MS = 600;

const JUNK = [/@nigerconnect\.test$/i, /\.local$/i, /^e2e/i, /^probe/i, /^bootcheck/i, /^check-/i, /@example\.com$/i];
const isReal = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !JUNK.some((re) => re.test(e));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const tokens = app.get(EmailTokenService, { strict: false });
  const mailer = app.get(MailerService, { strict: false });

  const candidates = await prisma.user.findMany({
    where: { emailVerified: false, email: { not: null } },
    select: { id: true, email: true, firstName: true },
    orderBy: { createdAt: 'asc' },
  });
  const targets = candidates.filter((u) => u.email && isReal(u.email));

  console.log(`\nUnverified: ${candidates.length} | real targets: ${targets.length} | mode: ${SEND ? 'SEND (live)' : 'DRY-RUN'}`);
  targets.forEach((u) => console.log(`  - ${u.email} (${u.firstName || '?'})`));

  let sent = 0, failed = 0;
  if (SEND) {
    for (const u of targets) {
      try {
        const token = await tokens.create(u.id, 'verify_email');
        await mailer.sendEmailVerification(u.email, token, u.firstName);
        sent++;
        console.log(`  ✅ sent → ${u.email}`);
      } catch (e) {
        failed++;
        console.error(`  ❌ ${u.email}: ${String(e)}`);
      }
      await sleep(THROTTLE_MS);
    }
  }

  await sleep(1500);
  await app.close();
  console.log(`\nDone. ${SEND ? `sent=${sent} failed=${failed}` : `${targets.length} would be emailed`}.`);
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });
