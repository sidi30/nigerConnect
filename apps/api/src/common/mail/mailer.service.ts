import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.validation';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
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

  constructor(private readonly config: ConfigService<Env, true>) {
    this.from = config.get('MAIL_FROM', { infer: true }) ?? 'no-reply@nigerconnect.local';
    this.webUrl =
      config.get('APP_WEB_URL', { infer: true }) ?? config.get('API_URL', { infer: true });
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
      });
      this.logger.log(`Mailer: SMTP → ${host}`);
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

  async sendPasswordReset(to: string, token: string, firstName?: string | null): Promise<void> {
    // token is base64url, but encode defensively for URLs.
    const link = `${this.webUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const safeName = this.esc(firstName);
    const html = `
      <div style="font-family:system-ui;max-width:540px;margin:0 auto;padding:24px;color:#1A0F0A">
        <h1 style="color:#E05206">NigerConnect</h1>
        <h2>Réinitialiser ton mot de passe</h2>
        <p>Bonjour ${safeName},</p>
        <p>Tu as demandé à réinitialiser ton mot de passe. Clique sur le lien ci-dessous — il est valable 1 heure.</p>
        <p><a href="${link}" style="display:inline-block;background:#E05206;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Réinitialiser mon mot de passe</a></p>
        <p style="color:#8B7355;font-size:13px">Si tu n'es pas à l'origine de cette demande, ignore simplement ce message.</p>
        <p style="color:#C4B8A6;font-size:12px;margin-top:32px">Lien direct : ${link}</p>
      </div>`;
    const text = `NigerConnect — Réinitialisation du mot de passe\n\nBonjour ${firstName ?? ''},\nTu as demandé à réinitialiser ton mot de passe.\nClique sur ce lien (valable 1h) : ${link}\n\nSi tu n'es pas à l'origine, ignore ce message.`;
    await this.send({ to, subject: 'NigerConnect — Réinitialisation du mot de passe', html, text });
  }

  async sendEmailVerification(
    to: string,
    token: string,
    firstName?: string | null,
  ): Promise<void> {
    const link = `${this.webUrl}/verify-email?token=${encodeURIComponent(token)}`;
    const safeName = this.esc(firstName);
    const html = `
      <div style="font-family:system-ui;max-width:540px;margin:0 auto;padding:24px;color:#1A0F0A">
        <h1 style="color:#E05206">NigerConnect 🇳🇪</h1>
        <h2>Confirme ton email</h2>
        <p>Bienvenue ${safeName} ! Confirme ton adresse pour profiter de toute la communauté.</p>
        <p><a href="${link}" style="display:inline-block;background:#E05206;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">Confirmer mon email</a></p>
        <p style="color:#8B7355;font-size:13px">Lien valable 24 heures.</p>
        <p style="color:#C4B8A6;font-size:12px;margin-top:32px">Lien direct : ${link}</p>
      </div>`;
    const text = `NigerConnect — Confirme ton email\n\nBienvenue ${firstName ?? ''} !\nClique sur ce lien (24h) pour confirmer : ${link}`;
    await this.send({ to, subject: 'NigerConnect — Confirme ton email', html, text });
  }
}
