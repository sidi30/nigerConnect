import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.validation';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>;
}

/**
 * Transports by priority:
 *   1. SMTP (if SMTP_HOST set) — real delivery
 *   2. JSON transport — logs rendered email to console (dev / CI / test)
 *
 * For production on Render / Railway, set SMTP_HOST/USER/PASS or swap for Resend.
 */
@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter!: Transporter;
  private readonly from: string;
  /**
   * Web URL the email links point at. The reset-password and verify-email
   * routes are SERVED BY THE WEB app — we MUST NOT link to the API directly:
   *   - `/api/auth/reset-password` is `@Post()` only → clicking the email
   *     yields HTTP 405. Always send users to the web frontend, which then
   *     POSTs to the API.
   *   - `/api/auth/verify-email` is `@Get()` and works, but returns JSON
   *     instead of a friendly page. The web `/verify-email` route wraps it.
   * In dev, `APP_WEB_URL` falls back to API_URL since the dev API can serve
   * the JSON-only verify endpoint and the user is the developer themselves.
   */
  private readonly webUrl: string;

  /** DKIM signing config, built from env when all parts are present. */
  private readonly dkim?: { domainName: string; keySelector: string; privateKey: string };
  /** Bare email address parsed out of MAIL_FROM (for Reply-To / unsubscribe). */
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.from = config.get('MAIL_FROM', { infer: true }) ?? 'no-reply@nigerconnect.local';
    this.fromAddress = this.from.match(/<([^>]+)>/)?.[1] ?? this.from;
    this.webUrl =
      config.get('APP_WEB_URL', { infer: true }) ?? config.get('API_URL', { infer: true });

    const dkimDomain = config.get('DKIM_DOMAIN', { infer: true });
    const dkimSelector = config.get('DKIM_SELECTOR', { infer: true });
    const dkimKeyB64 = config.get('DKIM_PRIVATE_KEY_B64', { infer: true });
    if (dkimDomain && dkimSelector && dkimKeyB64) {
      this.dkim = {
        domainName: dkimDomain,
        keySelector: dkimSelector,
        // Stored base64-encoded so the multiline PEM survives .env / compose.
        privateKey: Buffer.from(dkimKeyB64, 'base64').toString('utf8'),
      };
    }
  }

  onModuleInit(): void {
    const host = this.config.get('SMTP_HOST', { infer: true });
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(this.config.get('SMTP_PORT', { infer: true }) ?? 587),
        secure: this.config.get('SMTP_SECURE', { infer: true }) === 'true',
        auth: {
          user: this.config.get('SMTP_USER', { infer: true }),
          pass: this.config.get('SMTP_PASS', { infer: true }),
        },
        // DKIM signing (when configured) so receivers see DKIM=pass alongside
        // SPF — required to stay out of spam under DMARC. Key + selector live in
        // env; the matching public key must be published at
        // <selector>._domainkey.<domain> in DNS.
        ...(this.dkim ? { dkim: this.dkim } : {}),
      });
      this.logger.log(
        `Mailer: SMTP → ${host}${this.dkim ? ` (DKIM: ${this.dkim.keySelector}._domainkey.${this.dkim.domainName})` : ' (no DKIM)'}`,
      );
    } else {
      // Dev: log to console
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      this.logger.log('Mailer: console (dev mode — set SMTP_HOST to send real emails)');
    }
  }

  async send(input: SendMailInput): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        replyTo: this.fromAddress,
        ...(input.attachments ? { attachments: input.attachments } : {}),
        // List-Unsubscribe improves inbox placement even for transactional mail;
        // mailto target is the sending address. Helps reputation with Gmail.
        headers: {
          'List-Unsubscribe': `<mailto:${this.fromAddress}?subject=unsubscribe>`,
        },
      });
      if ((info as { message?: string }).message) {
        // Dev json transport — log the whole email
        this.logger.log(
          `✉️  [${input.to}] ${input.subject}\n${input.text}\n— (set SMTP_HOST to deliver for real)`,
        );
      } else {
        this.logger.log(`✉️  Sent to ${input.to}: ${input.subject}`);
      }
    } catch (error) {
      this.logger.error(`Failed to send email to ${input.to}`, error as Error);
    }
  }

  // ── Templates ───────────────────────────────────────────────

  /** HTML-escape user-provided strings before injection into email templates. */
  private esc(s: string | null | undefined): string {
    if (!s) return '';
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Brand tokens (kept in sync with apps/web/tailwind.config.ts).
  private static readonly BRAND = {
    orange: '#E05206',
    orangeBright: '#FF6D00',
    green: '#0DB02B',
    cream: '#FDFBF7',
    brown: '#1A0F0A',
    tan500: '#8B7355',
    tan400: '#C4B8A6',
    tan100: '#F5EDE0',
  };

  private static readonly FONT =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  /**
   * Logo lock-up recreated in pure HTML/CSS (no external image → renders in
   * every client incl. Gmail/Outlook which block or strip SVG/remote images).
   * Mirrors favicon.svg: white rounded square + orange "N", green status dot,
   * white "NigerConnect" wordmark on the orange header band.
   */
  private logoLockup(): string {
    const b = MailerService.BRAND;
    return `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
        <tr>
          <td style="vertical-align:middle;padding-right:12px;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
              <td width="48" height="48" align="center" valign="middle"
                  style="width:48px;height:48px;background:#ffffff;border-radius:12px;
                         font-family:${MailerService.FONT};font-size:30px;font-weight:800;
                         color:${b.orange};line-height:48px;text-align:center;">N</td>
            </tr></table>
          </td>
          <td style="vertical-align:middle;">
            <span style="font-family:${MailerService.FONT};font-size:24px;font-weight:800;
                         color:#ffffff;letter-spacing:-0.3px;">NigerConnect</span>
            <span style="font-size:18px;vertical-align:middle;">&nbsp;🇳🇪</span>
          </td>
        </tr>
      </table>`;
  }

  /** Bulletproof CTA button (padding-based so it survives Outlook). */
  private button(link: string, label: string): string {
    const b = MailerService.BRAND;
    return `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:8px auto 4px;">
        <tr>
          <td align="center" bgcolor="${b.orange}" style="border-radius:12px;
              background:${b.orange};background:linear-gradient(135deg,${b.orange} 0%,${b.orangeBright} 100%);">
            <a href="${link}" target="_blank"
               style="display:inline-block;padding:15px 34px;font-family:${MailerService.FONT};
                      font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;
                      border-radius:12px;">${label}</a>
          </td>
        </tr>
      </table>`;
  }

  /**
   * Wraps the inner body in the branded, centered, mobile-friendly shell:
   * cream backdrop → white rounded card → orange header (logo) → body → footer.
   * Everything is table-based with inline styles for max client compatibility.
   */
  private layout(opts: { preheader: string; bodyHtml: string }): string {
    const b = MailerService.BRAND;
    return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>NigerConnect</title>
</head>
<body style="margin:0;padding:0;background:${b.cream};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${this.esc(opts.preheader)}</div>
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${b.cream};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0"
               style="width:600px;max-width:100%;background:#ffffff;border-radius:18px;overflow:hidden;
                      box-shadow:0 4px 20px rgba(26,15,10,0.08);">
          <!-- Header -->
          <tr>
            <td align="center" bgcolor="${b.orange}"
                style="background:${b.orange};background:linear-gradient(135deg,${b.orange} 0%,${b.orangeBright} 100%);
                       padding:32px 24px;">
              ${this.logoLockup()}
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;font-family:${MailerService.FONT};
                       color:${b.brown};font-size:16px;line-height:1.6;">
              ${opts.bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid ${b.tan100};
                       font-family:${MailerService.FONT};">
              <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${b.orange};">NigerConnect 🇳🇪</p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:${b.tan500};">
                Le réseau de la diaspora nigérienne.<br />
                Tu reçois cet email parce qu'une adresse a été utilisée pour s'inscrire sur NigerConnect.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-family:${MailerService.FONT};font-size:11px;color:${b.tan400};">
          © NigerConnect — Tous droits réservés.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  async sendPasswordReset(to: string, token: string, firstName?: string | null): Promise<void> {
    const b = MailerService.BRAND;
    // token is base64url, but encode defensively for URLs.
    const link = `${this.webUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const safeName = this.esc(firstName);
    const greeting = safeName ? `Bonjour ${safeName},` : 'Bonjour,';
    const bodyHtml = `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:${b.brown};">Réinitialise ton mot de passe</h1>
      <p style="margin:0 0 12px;">${greeting}</p>
      <p style="margin:0 0 24px;">Tu as demandé à réinitialiser ton mot de passe. Clique sur le bouton ci-dessous — le lien est valable <strong>1 heure</strong>.</p>
      ${this.button(link, 'Réinitialiser mon mot de passe')}
      <p style="margin:24px 0 0;font-size:13px;color:${b.tan500};">Si tu n'es pas à l'origine de cette demande, ignore simplement ce message — ton mot de passe reste inchangé.</p>
      <p style="margin:24px 0 0;font-size:12px;color:${b.tan400};word-break:break-all;">Le bouton ne marche pas ? Copie ce lien :<br /><a href="${link}" style="color:${b.orange};">${link}</a></p>`;
    const text = `NigerConnect — Réinitialisation du mot de passe\n\n${greeting}\nTu as demandé à réinitialiser ton mot de passe.\nClique sur ce lien (valable 1h) : ${link}\n\nSi tu n'es pas à l'origine, ignore ce message.`;
    const html = this.layout({ preheader: 'Réinitialise ton mot de passe NigerConnect.', bodyHtml });
    await this.send({ to, subject: 'NigerConnect — Réinitialisation du mot de passe', html, text });
  }

  /** Big, centered, mono 6-digit code block the user types into the app. */
  private codeBlock(code: string): string {
    const b = MailerService.BRAND;
    const spaced = this.esc(code).split('').join('&nbsp;&nbsp;');
    return `
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:8px auto 4px;">
        <tr>
          <td align="center" style="background:${b.tan100};border:1px solid ${b.tan400};
              border-radius:14px;padding:18px 28px;">
            <div style="font-family:'Courier New',Consolas,monospace;font-size:34px;font-weight:800;
                        letter-spacing:2px;color:${b.brown};line-height:1;">${spaced}</div>
          </td>
        </tr>
      </table>`;
  }

  async sendEmailVerification(
    to: string,
    token: string,
    code: string,
    firstName?: string | null,
  ): Promise<void> {
    const b = MailerService.BRAND;
    const link = `${this.webUrl}/verify-email?token=${encodeURIComponent(token)}`;
    const safeName = this.esc(firstName);
    const greeting = safeName ? `Bienvenue ${safeName} !` : 'Bienvenue !';
    const bodyHtml = `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:${b.brown};">Active ton compte</h1>
      <p style="margin:0 0 12px;">${greeting}</p>
      <p style="margin:0 0 20px;">Plus qu'une étape. Saisis ce code dans l'application NigerConnect pour activer ton compte :</p>
      ${this.codeBlock(code)}
      <p style="margin:18px 0 24px;text-align:center;font-size:13px;color:${b.tan500};">Code valable <strong>24 heures</strong>.</p>
      <p style="margin:0 0 12px;font-size:14px;color:${b.tan500};">Tu ouvres cet email sur ordinateur ? Tu peux aussi cliquer :</p>
      ${this.button(link, 'Activer mon compte')}
      <p style="margin:24px 0 0;font-size:13px;color:${b.tan500};">Si tu n'es pas à l'origine de cette inscription, ignore ce message.</p>
      <p style="margin:18px 0 0;font-size:12px;color:${b.tan400};word-break:break-all;">Lien direct : <a href="${link}" style="color:${b.orange};">${link}</a></p>`;
    const text =
      `NigerConnect — Active ton compte\n\n${greeting}\n` +
      `Ton code d'activation : ${code}\n` +
      `Saisis-le dans l'application (valable 24h).\n\n` +
      `Sur ordinateur, tu peux aussi cliquer : ${link}\n\n` +
      `Si tu n'es pas à l'origine de cette inscription, ignore ce message.`;
    const html = this.layout({ preheader: `Ton code d'activation NigerConnect : ${code}`, bodyHtml });
    await this.send({ to, subject: 'NigerConnect — Active ton compte 🇳🇪', html, text });
  }

  /** A single "feature" row in the welcome email (emoji bubble + title + text). */
  private featureRow(emoji: string, title: string, text: string): string {
    const b = MailerService.BRAND;
    return `
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="margin:0 0 14px;">
        <tr>
          <td width="44" valign="top" style="width:44px;">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
              <td width="36" height="36" align="center" valign="middle"
                  style="width:36px;height:36px;background:${b.tan100};border-radius:10px;
                         font-size:18px;line-height:36px;text-align:center;">${emoji}</td>
            </tr></table>
          </td>
          <td valign="top" style="padding-left:4px;">
            <p style="margin:0;font-size:15px;font-weight:700;color:${b.brown};line-height:1.4;">${title}</p>
            <p style="margin:2px 0 0;font-size:13px;color:${b.tan500};line-height:1.5;">${text}</p>
          </td>
        </tr>
      </table>`;
  }

  /**
   * Welcome email — sent ONCE, right after a user verifies their email. Warm,
   * celebratory, and a quick tour of what NigerConnect offers, with a CTA back
   * into the app. Reuses the shared branded layout for client compatibility.
   */
  async sendWelcome(to: string, firstName?: string | null): Promise<void> {
    const b = MailerService.BRAND;
    const safeName = this.esc(firstName);
    const greeting = safeName ? `Bienvenue ${safeName} ! 🎉` : 'Bienvenue ! 🎉';
    const bodyHtml = `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:${b.brown};">${greeting}</h1>
      <p style="margin:0 0 8px;">Ton compte est activé. Tu fais désormais partie de la communauté de la diaspora nigérienne — ravis de t'accueillir ! 🇳🇪</p>
      <p style="margin:0 0 22px;font-weight:700;color:${b.brown};">Voici ce que tu peux faire dès maintenant :</p>
      ${this.featureRow('🗺️', 'Trouve la diaspora autour de toi', 'Repère les membres et associations proches sur la carte interactive.')}
      ${this.featureRow('🤝', "Demande et offre de l'entraide", 'Logement, démarches admin, bons plans — la communauté répond.')}
      ${this.featureRow('🏛️', 'Rejoins une association', 'Connecte-toi aux associations nigériennes de ta ville.')}
      ${this.featureRow('💬', 'Discute en direct', 'Messagerie en temps réel avec les autres membres.')}
      <div style="margin:24px 0 4px;">${this.button(this.webUrl, 'Ouvrir NigerConnect')}</div>
      <p style="margin:24px 0 0;font-size:13px;color:${b.tan500};">Complète ton profil et ajoute ta ville pour apparaître sur la carte et être trouvé par la communauté.</p>`;
    const text =
      `NigerConnect — ${safeName ? `Bienvenue ${firstName} !` : 'Bienvenue !'}\n\n` +
      `Ton compte est activé. Tu fais partie de la communauté de la diaspora nigérienne.\n\n` +
      `Ce que tu peux faire :\n` +
      `- Trouver la diaspora autour de toi sur la carte\n` +
      `- Demander et offrir de l'entraide\n` +
      `- Rejoindre une association de ta ville\n` +
      `- Discuter en direct avec les membres\n\n` +
      `Ouvre NigerConnect : ${this.webUrl}\n\n` +
      `Complète ton profil et ajoute ta ville pour apparaître sur la carte.`;
    const html = this.layout({
      preheader: 'Ton compte NigerConnect est activé — bienvenue dans la communauté !',
      bodyHtml,
    });
    await this.send({ to, subject: 'Bienvenue sur NigerConnect 🇳🇪', html, text });
  }

  /**
   * RGPD data export delivered by email, with the full JSON dump attached.
   * `json` is the already-serialized export payload.
   */
  async sendDataExport(to: string, json: string, firstName?: string | null): Promise<void> {
    const b = MailerService.BRAND;
    const safeName = this.esc(firstName);
    const greeting = safeName ? `Bonjour ${safeName},` : 'Bonjour,';
    const filename = `nigerconnect-donnees-${new Date().toISOString().slice(0, 10)}.json`;
    const bodyHtml = `
      <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:${b.brown};">Tes données personnelles</h1>
      <p style="margin:0 0 12px;">${greeting}</p>
      <p style="margin:0 0 12px;">Tu as demandé une copie de tes données personnelles (RGPD, article 20). Tu la trouveras en <strong>pièce jointe</strong> de cet email, au format JSON (<code>${filename}</code>).</p>
      <p style="margin:0 0 12px;">L'export contient ton profil, tes publications, tes relations et ton activité. Pour ta sécurité, il <strong>ne contient aucun identifiant de connexion</strong> (mot de passe, secret MFA, identifiants OAuth).</p>
      <p style="margin:18px 0 0;font-size:13px;color:${b.tan500};">Si tu n'es pas à l'origine de cette demande, change ton mot de passe et contacte-nous.</p>`;
    const text =
      `NigerConnect — Tes données personnelles\n\n${greeting}\n` +
      `Ta copie de données (RGPD art. 20) est en pièce jointe (${filename}).\n` +
      `Elle ne contient aucun identifiant de connexion.\n\n` +
      `Si tu n'es pas à l'origine de cette demande, change ton mot de passe.`;
    const html = this.layout({ preheader: 'Ta copie de données personnelles NigerConnect.', bodyHtml });
    await this.send({
      to,
      subject: 'NigerConnect — Tes données personnelles',
      html,
      text,
      attachments: [{ filename, content: json, contentType: 'application/json' }],
    });
  }
}
