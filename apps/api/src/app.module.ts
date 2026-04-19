import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigModule } from './common/config/config.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/storage.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './profile/profile.module';
import { SocialModule } from './social/social.module';
import { FeedModule } from './feed/feed.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    HealthModule,
    AuthModule,
    ProfileModule,
    SocialModule,
    FeedModule,
    ChatModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
