/**
 * One-off catch-up: email every ALREADY identity-verified user the new
 * "Identité vérifiée" confirmation, so members approved before this template
 * existed still get the notice (and learn they can create pages/associations).
 *
 * Reuses the real MailerService (branded template, production SMTP / MAIL_FROM /
 * APP_WEB_URL). Going forward, AuthService.reviewIdentity sends this
 * automatically on each approval — this script only backfills the existing
 * approved users.
 *
 * SAFETY:
 *   - Dry-run by DEFAULT. Pass `--send` to really deliver.
 *   - Skips test/junk addresses so we never blast E2E seed data.
 *   - `--limit=N` caps how many are processed.
 *   - Throttled (THROTTLE_MS between sends) to stay under SMTP rate limits.
 *
 * Run (Windows dev box needs the Norton CA for TLS; on the Linux VPS drop it):
 *   # preview who would be emailed
 *   npx ts-node --transpile-only scripts/send-identity-approved-blast.ts
 *   # really send
 *   npx ts-node --transpile-only scripts/send-identity-approved-blast.ts --send
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MailerService } from '../src/common/mail/mailer.service';

const SEND = process.argv.includes('--send');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : undefined;
const THROTTLE_MS = 500;

const JUNK = [/@nigerconnect\.test$/i, /\.local$/i, /^e2e/i, /^probe/i, /^bootcheck/i];
const isReal = (email: string): boolean =>
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !JUNK.some((re) => re.test(email));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const mailer = app.get(MailerService, { strict: false });

  const candidates = await prisma.user.findMany({
    where: { identityStatus: 'approved', email: { not: null } },
    select: { id: true, email: true, firstName: true },
    orderBy: { createdAt: 'asc' },
  });

  const targets = candidates.filter((u) => u.email && isReal(u.email));
  const skipped = candidates.length - targets.length;
  const batch = LIMIT ? targets.slice(0, LIMIT) : targets;

  // eslint-disable-next-line no-console
  console.log(
    `\nApproved: ${candidates.length} | real targets: ${targets.length} | junk skipped: ${skipped}` +
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
      await mailer.sendIdentityApproved(u.email as string, u.firstName);
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
