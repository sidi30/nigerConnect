/**
 * One-off: send a SAMPLE "Active ton compte" email so the template can be
 * previewed in a real inbox. Reuses the real MailerService (same template,
 * same SMTP config, same MAIL_FROM / APP_WEB_URL as production).
 *
 * Run (Windows dev box needs the Norton CA for IONOS TLS):
 *   NODE_EXTRA_CA_CERTS=C:/Users/ramzi/.certs/norton-root.pem \
 *     npx ts-node --transpile-only scripts/send-sample-verification.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MailerService } from '../src/common/mail/mailer.service';

const TO = process.argv[2] ?? 'sirtecnologie@gmail.com';
const NAME = process.argv[3] ?? 'Sidi';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const mailer = app.get(MailerService);
  // Demo token — the link is for previewing the template; it is not a live
  // verification token (no matching row in email_tokens).
  const demoToken = `demo-preview-${Date.now()}`;
  await mailer.sendEmailVerification(TO, demoToken, '123456', NAME);
  // Mailer logs success/failure to the Nest logger; give the SMTP call a beat.
  await new Promise((r) => setTimeout(r, 1500));
  await app.close();
  // eslint-disable-next-line no-console
  console.log(`\n✅ Sample verification email dispatched to ${TO}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', e);
  process.exit(1);
});
