import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    API_URL: z.string().url().default('http://localhost:3000'),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    S3_ENDPOINT: z.string().url().optional(),
    // Public-facing S3/MinIO endpoint used to sign URLs the CLIENT will hit
    // (uploads + private-file presigned downloads). When MinIO sits behind a
    // reverse proxy, S3_ENDPOINT is the internal Docker hostname (unreachable
    // from outside) and S3_PUBLIC_ENDPOINT is the public URL. Falls back to
    // S3_ENDPOINT if not set.
    S3_PUBLIC_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('nigerconnect'),
    S3_PRIVATE_BUCKET: z.string().default('nigerconnect-private'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
    /**
     * Whether presigned uploads should pin `x-amz-server-side-encryption: AES256`
     * into the signature. Default OFF: MinIO standalone (without a KMS sidecar)
     * rejects SSE requests with HTTP 501 NotImplemented, so forcing it broke
     * every upload on dev + on the VPS-hosted MinIO. Turn ON in real AWS S3
     * production (it works there transparently). The bucket-level "default
     * encryption" toggle in the AWS console covers the at-rest requirement
     * just as well, without requiring the client to cooperate.
     */
    S3_SSE: z.coerce.boolean().default(false),
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
      // Email verification + password reset links MUST point at the web
      // frontend, not the API (the API's reset-password route is POST-only).
      // Without APP_WEB_URL the mailer falls back to API_URL — which used to
      // produce 405-returning links. Fail fast in prod.
      'APP_WEB_URL',
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

    // CORS_ORIGINS in prod must NOT be the localhost dev default — that would
    // accept any localhost origin and silently undermine the policy.
    const localhostOnly = env.CORS_ORIGINS.every((o) => /localhost|127\.0\.0\.1/.test(o));
    if (env.CORS_ORIGINS.length === 0 || localhostOnly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must list at least one non-localhost origin in production',
      });
    }

    // SMTP / Resend coherence: if any SMTP_* is set, all of HOST/USER/PASS must
    // be set. Otherwise, mail silently falls back to JSON transport in prod —
    // a real footgun (password resets just stop working).
    const smtpFields = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const;
    const smtpSet = smtpFields.filter((k) => env[k]);
    if (smtpSet.length > 0 && smtpSet.length < smtpFields.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST/USER/PASS must all be set together (or all empty to disable SMTP)',
      });
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
