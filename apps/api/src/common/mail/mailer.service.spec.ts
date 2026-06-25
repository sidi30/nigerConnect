/**
 * Security regression — invitation email rendering (gwani-pentest email delta).
 *
 * Proves:
 *  1. inviterName is HTML-escaped in the HTML body (no stored/reflected HTML
 *     injection via a crafted displayName).
 *  2. Control chars (CR/LF/tab) are stripped from the inviterName before it
 *     reaches the Subject header and the text/plain body (header-injection
 *     defense-in-depth on top of nodemailer's own folding).
 *  3. The invitee address (`to`) is passed through untouched.
 */
import { MailerService } from './mailer.service';

function makeMailer(): { mailer: MailerService; sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  // No SMTP_HOST → onModuleInit picks the jsonTransport. We replace the
  // transporter with a capture stub so we can assert on the rendered message.
  const config = {
    get: (key: string) => {
      if (key === 'MAIL_FROM') return 'NigerConnect <contact@nigerconnect.app>';
      return undefined;
    },
  };
  const mailer = new MailerService(config as never);
  mailer.onModuleInit();
  // Override transporter with a capture stub.
  (mailer as unknown as { transporter: { sendMail: (m: Record<string, unknown>) => Promise<unknown> } }).transporter = {
    sendMail: async (m: Record<string, unknown>) => {
      sent.push(m);
      return { messageId: 'x' };
    },
  };
  return { mailer, sent };
}

describe('MailerService — sendInvitationEmail security', () => {
  it('HTML-escapes the inviter name in the HTML body (no HTML injection)', async () => {
    const { mailer, sent } = makeMailer();
    await mailer.sendInvitationEmail(
      'invitee@example.com',
      '<img src=x onerror=alert(1)>',
      'ABC1234567',
      'https://nigerconnect.app/invite/ABC1234567',
    );
    const html = sent[0]?.['html'] as string;
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('strips CR/LF/tab from inviter name in the Subject (header-injection defense)', async () => {
    const { mailer, sent } = makeMailer();
    await mailer.sendInvitationEmail(
      'invitee@example.com',
      'Bob\r\nBcc: victim@evil.com\tEvil',
      'ABC1234567',
      'https://nigerconnect.app/invite/ABC1234567',
    );
    const subject = sent[0]?.['subject'] as string;
    const text = sent[0]?.['text'] as string;
    expect(subject).not.toMatch(/[\r\n\t]/);
    expect(subject).not.toContain('Bcc:'.concat('\n')); // no injected header line
    expect(subject).toBe("Bob Bcc: victim@evil.com Evil t'invite sur NigerConnect 🇳🇪");
    expect(text).not.toMatch(/^Bcc:/m);
  });

  it('passes the invitee address through unchanged', async () => {
    const { mailer, sent } = makeMailer();
    await mailer.sendInvitationEmail(
      'invitee@example.com',
      'Aïcha',
      'ABC1234567',
      'https://nigerconnect.app/invite/ABC1234567',
    );
    expect(sent[0]?.['to']).toBe('invitee@example.com');
  });
});
