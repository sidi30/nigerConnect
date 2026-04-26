import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    API_URL: z.string().url().default('http://localhost:3000'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('nigerconnect'),
    S3_PRIVATE_BUCKET: z.string().default('nigerconnect-private'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
    CDN_URL: z.string().url().optional(),

    // JWT: RS256 keypair + audience/issuer claims.
    // In production, BOTH keys and both claims are required. A second public
    // key path (PREVIOUS) is accepted during rotation windows.
    JWT_PRIVATE_KEY_PATH: z.string().optional(),
    JWT_PUBLIC_KEY_PATH: z.string().optional(),
    JWT_PREVIOUS_PUBLIC_KEY_PATH: z.string().optional(),
    JWT_ACCESS_EXPIRES: z.string().default('15m'),
    JWT_REFRESH_EXPIRES: z.string().default('14d'),
    JWT_ISSUER: z.string().default('nigerconnect-api'),
    JWT_AUDIENCE: z.string().default('nigerconnect-app'),

    // AES-256-GCM key used to encrypt column-level sensitive data
    // (MFA secrets, future encrypted PII). 32 bytes, base64-encoded.
    // Required in production. Generate with:
    //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
    DATA_ENCRYPTION_KEY: z.string().optional(),

    CORS_ORIGINS: z
      .string()
      .default('http://localhost:8081,http://localhost:3001')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID_ANDROID: z.string().optional(),
    GOOGLE_CLIENT_ID_IOS: z.string().optional(),
    GOOGLE_CLIENT_ID_WEB: z.string().optional(),
    FACEBOOK_CLIENT_ID: z.string().optional(),
    FACEBOOK_CLIENT_SECRET: z.string().optional(),
    APPLE_CLIENT_ID: z.string().optional(),
    APPLE_TEAM_ID: z.string().optional(),
    APPLE_KEY_ID: z.string().optional(),
    APPLE_PRIVATE_KEY: z.string().optional(),

    FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_PHONE_NUMBER: z.string().optional(),

    MAIL_FROM: z.string().default('NigerConnect <no-reply@nigerconnect.local>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().optional(),
    SMTP_SECURE: z.string().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    APP_WEB_URL: z.string().url().optional(),

    SENTRY_DSN: z.string().optional(),
    AXIOM_TOKEN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    const requiredInProd: Array<keyof typeof env> = [
      'JWT_PRIVATE_KEY_PATH',
      'JWT_PUBLIC_KEY_PATH',
      'DATA_ENCRYPTION_KEY',
    ];
    for (const key of requiredInProd) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when NODE_ENV=production`,
        });
      }
    }

    if (env.DATA_ENCRYPTION_KEY) {
      try {
        const buf = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
        if (buf.length !== 32) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['DATA_ENCRYPTION_KEY'],
            message: 'DATA_ENCRYPTION_KEY must be exactly 32 bytes (base64-encoded)',
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATA_ENCRYPTION_KEY'],
          message: 'DATA_ENCRYPTION_KEY must be valid base64',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
