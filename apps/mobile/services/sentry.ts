import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

let initialized = false;

function resolveDsn(): string | null {
  const fromExtra = Constants.expoConfig?.extra?.sentryDsn;
  const fromEnv = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (typeof fromExtra === 'string' && fromExtra.length > 0) return fromExtra;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return null;
}

/**
 * Initialize Sentry once, at app startup. Safe to call from any platform:
 *   - No-op if DSN is missing (dev / preview without config).
 *   - No-op on subsequent calls.
 *   - Lower traces sample rate in production to avoid quota burn.
 */
export function initSentry(): void {
  if (initialized) return;
  const dsn = resolveDsn();
  if (!dsn) return;

  Sentry.init({
    dsn,
    enableAutoSessionTracking: true,
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    // Disable capture in dev unless the user really wants it — noisy otherwise.
    enabled: !__DEV__,
    release: Constants.expoConfig?.version,
    dist: `${Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? 'unknown'}`,
    // Strip any URL-like PII from breadcrumbs (search params are frequently IDs/emails).
    beforeBreadcrumb: (breadcrumb) => {
      if (breadcrumb.data && typeof breadcrumb.data === 'object' && 'url' in breadcrumb.data) {
        const url = String((breadcrumb.data as { url: unknown }).url ?? '');
        breadcrumb.data = { ...breadcrumb.data, url: url.split('?')[0] };
      }
      return breadcrumb;
    },
  });
  initialized = true;
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  Sentry.captureException(error, { extra: context });
}

/** Identify the active user for every subsequent event. Call on login, clear on logout. */
export function setSentryUser(user: { id: string; email?: string | null } | null): void {
  if (!initialized) return;
  if (user) {
    Sentry.setUser({ id: user.id, email: user.email ?? undefined });
  } else {
    Sentry.setUser(null);
  }
}
