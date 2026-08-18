import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigModule } from './common/config/config.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LastSeenInterceptor } from './common/interceptors/last-seen.interceptor';
import { MetricsModule } from './common/metrics/metrics.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/storage.module';
import { MailModule } from './common/mail/mail.module';
import { AppThrottleModule } from './common/throttle/throttle.module';
import { SettingsModule } from './common/settings/settings.module';
import { AuditModule } from './common/audit/audit.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './profile/profile.module';
import { SocialModule } from './social/social.module';
import { FeedModule } from './feed/feed.module';
import { ChatModule } from './chat/chat.module';
import { GeoModule } from './geo/geo.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { RatesModule } from './rates/rates.module';
import { AssociationModule } from './association/association.module';
import { NotificationModule } from './notification/notification.module';
import { ModerationModule } from './moderation/moderation.module';
import { PageModule } from './page/page.module';
import { PollModule } from './poll/poll.module';
import { ReviewModule } from './review/review.module';
import { AdminModule } from './admin/admin.module';
import { OfficialModule } from './official/official.module';
import { NewsletterModule } from './newsletter/newsletter.module';
import { InvitationsModule } from './invitations/invitations.module';
import { ContactModule } from './contact/contact.module';
import { DigestModule } from './digest/digest.module';
import { AnimationModule } from './animation/animation.module';
import { ObservabilityModule } from './observability/observability.module';

@Module({
  imports: [
    AppConfigModule,
    // Registers the /metrics endpoint AND the middleware that records every
    // request (access log + Prometheus counters). Kept high in the list so its
    // middleware wraps the whole app.
    MetricsModule,
    CryptoModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    MailModule,
    AppThrottleModule,
    SettingsModule,
    AuditModule,
    HealthModule,
    AuthModule,
    ProfileModule,
    SocialModule,
    FeedModule,
    ChatModule,
    GeoModule,
    MarketplaceModule,
    RatesModule,
    AssociationModule,
    NotificationModule,
    ModerationModule,
    PageModule,
    PollModule,
    ReviewModule,
    AdminModule,
    OfficialModule,
    NewsletterModule,
    InvitationsModule,
    ContactModule,
    DigestModule,
    AnimationModule,
    ObservabilityModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LastSeenInterceptor },
  ],
})
export class AppModule {}
