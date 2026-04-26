import { resolve } from 'path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // Look in several plausible locations so the API starts from any cwd
      // (pnpm filter from the monorepo root, `nest start` from apps/api, dist from /app).
      envFilePath: [
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), 'apps/api/.env'),
        resolve(__dirname, '../../../.env'),
      ],
    }),
  ],
})
export class AppConfigModule {}
