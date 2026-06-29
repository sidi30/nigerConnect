import { Body, Controller, Get, Header, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  appUnsubscribeSchema,
  subscribeSchema,
  unsubscribeSchema,
  type AppUnsubscribeDto,
  type SubscribeDto,
  type UnsubscribeDto,
} from './dto/newsletter.dto';
import { NewsletterService } from './newsletter.service';

/**
 * Public newsletter endpoints — no auth (used before any session exists). Both
 * routes are explicitly @Public so the global JWT + email-verified guards skip
 * them. Subscribe is tightly throttled to deter abuse/enumeration.
 */
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Public()
  @Throttle({ short: { limit: 5, ttl: 60_000 }, long: { limit: 20, ttl: 3_600_000 } })
  @Post('subscribe')
  @HttpCode(200)
  async subscribe(
    @Body(new ZodValidationPipe(subscribeSchema)) dto: SubscribeDto,
  ): Promise<{ ok: true }> {
    await this.newsletter.subscribe(dto);
    // Always a generic success — never reveal whether the address already existed.
    return { ok: true };
  }

  @Public()
  @Get('unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribe(
    @Query(new ZodValidationPipe(unsubscribeSchema)) dto: UnsubscribeDto,
  ): Promise<string> {
    const ok = await this.newsletter.unsubscribe(dto.token);
    return ok ? this.page(SUCCESS_TITLE, SUCCESS_BODY) : this.page(ERROR_TITLE, ERROR_BODY);
  }

  // RFC 8058 one-click: Gmail/Outlook POST to the List-Unsubscribe URL (body
  // List-Unsubscribe=One-Click). Same effect as the GET, no HTML body needed.
  @Public()
  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribePost(
    @Query(new ZodValidationPipe(unsubscribeSchema)) dto: UnsubscribeDto,
  ): Promise<{ ok: boolean }> {
    const ok = await this.newsletter.unsubscribe(dto.token);
    return { ok };
  }

  /**
   * App-user opt-out from the link in announcement emails — flips
   * newsletterOptIn off. Critical service notices ignore this flag, so security
   * and outage messages still reach the user.
   */
  @Public()
  @Get('app-unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async appUnsubscribe(
    @Query(new ZodValidationPipe(appUnsubscribeSchema)) dto: AppUnsubscribeDto,
  ): Promise<string> {
    const ok = await this.newsletter.appUnsubscribe(dto.token);
    return ok
      ? this.page(SUCCESS_TITLE, APP_SUCCESS_BODY)
      : this.page(ERROR_TITLE, ERROR_BODY);
  }

  // RFC 8058 one-click POST counterpart of app-unsubscribe.
  @Public()
  @Post('app-unsubscribe')
  @HttpCode(200)
  async appUnsubscribePost(
    @Query(new ZodValidationPipe(appUnsubscribeSchema)) dto: AppUnsubscribeDto,
  ): Promise<{ ok: boolean }> {
    const ok = await this.newsletter.appUnsubscribe(dto.token);
    return { ok };
  }

  /** Minimal self-contained branded confirmation page (no external assets). */
  private page(title: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>NigerConnect — ${title}</title></head>
<body style="margin:0;background:#FDFBF7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:64px auto;padding:0 16px;text-align:center;">
    <div style="display:inline-grid;place-items:center;width:56px;height:56px;border-radius:14px;background:#E05206;color:#fff;font-size:30px;font-weight:800;">N</div>
    <h1 style="margin:24px 0 8px;font-size:22px;color:#1A0F0A;">${title}</h1>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#5A4634;">${body}</p>
  </div>
</body></html>`;
  }
}

const SUCCESS_TITLE = 'Désinscription confirmée';
const SUCCESS_BODY =
  "Tu ne recevras plus d'emails de la newsletter NigerConnect. À bientôt&nbsp;! 🇳🇪";
const APP_SUCCESS_BODY =
  "Tu ne recevras plus les annonces et nouveautés de NigerConnect par email. Tu peux réactiver ce choix à tout moment dans Réglages&nbsp;› Notifications. Les messages importants de sécurité te seront toujours envoyés. 🇳🇪";
const ERROR_TITLE = 'Lien invalide';
const ERROR_BODY =
  'Ce lien de désinscription est invalide ou a expiré. Contacte-nous si le problème persiste.';
