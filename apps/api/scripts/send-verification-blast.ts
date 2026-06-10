/**
 * Bulk "Active ton compte" sender — emails every still-unverified registered
 * user a fresh, LIVE verification link so they can activate their account.
 *
 * Reuses the real services: EmailTokenService (creates a valid, single-use
 * 24h token + invalidates older ones) and MailerService (branded template,
 * production SMTP / MAIL_FROM / APP_WEB_URL). The links it sends actually work.
 *
 * SAFETY:
 *   - Dry-run by DEFAULT. Pass `--send` to really deliver.
 *   - Skips test/junk addresses (@nigerconnect.test, *.local, e2e*, probe*,
 *     bootcheck*) so we never blast E2E seed data or bounce on dead domains.
 *   - `--limit N` caps how many are processed (handy for a first real batch).
 *   - Throttled (THROTTLE_MS between sends) to stay under IONOS rate limits.
 *
 * Run (Windows dev box needs the Norton CA for IONOS TLS; on the Linux VPS
 * drop NODE_EXTRA_CA_CERTS):
 *   # preview who would be emailed
 *   npx ts-node --transpile-only scripts/send-verification-blast.ts
 *   # really send, first 50 only
 *   npx ts-node --transpile-only scripts/send-verification-blast.ts --send --limit 50
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { EmailTokenService } from '../src/auth/email-token.service';
import { MailerService } from '../src/common/mail/mailer.service';

const SEND = process.argv.includes('--send');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined;
const THROTTLE_MS = 500;

// Addresses that are clearly not real users (E2E seeds, probes, dev domains).
const JUNK = [
  /@nigerconnect\.test$/i,
  /\.local$/i,
  /^e2e/i,
  /^probe/i,
  /^bootcheck/i,
];
const isReal = (email: string): boolean =>
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !JUNK.some((re) => re.test(email));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const tokens = app.get(EmailTokenService, { strict: false });
  const mailer = app.get(MailerService, { strict: false });

  const candidates = await prisma.user.findMany({
    where: { emailVerified: false, email: { not: null } },
    select: { id: true, email: true, firstName: true },
    orderBy: { createdAt: 'asc' },
  });

  const targets = candidates.filter((u) => u.email && isReal(u.email));
  const skipped = candidates.length - targets.length;
  const batch = LIMIT ? targets.slice(0, LIMIT) : targets;

  // eslint-disable-next-line no-console
  console.log(
    `\nUnverified: ${candidates.length} | real targets: ${targets.length} | junk skipped: ${skipped}` +
      `${LIMIT ? ` | capped to ${batch.length}` : ''}\nMode: ${SEND ? 'SEND (live)' : 'DRY-RUN (no email sent — pass --send)'}\n`,
  );

  let sent = 0;
  let failed = 0;
  for (const u of batch) {
    if (!SEND) {
      // eslint-disable-next-line no-console
      console.log(`  would send → ${u.email}`);
      continue;
    }
    try {
      const { token, code } = await tokens.createWithCode(u.id, 'verify_email');
      await mailer.sendEmailVerification(u.email as string, token, code, u.firstName);
      sent++;
      // eslint-disable-next-line no-console
      console.log(`  ✅ ${u.email}`);
    } catch (e) {
      failed++;
      // eslint-disable-next-line no-console
      console.error(`  ❌ ${u.email}: ${String(e)}`);
    }
    await sleep(THROTTLE_MS);
  }

  await sleep(1500);
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`\nDone. ${SEND ? `sent=${sent} failed=${failed}` : `${batch.length} would be emailed`}.`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', e);
  process.exit(1);
});
