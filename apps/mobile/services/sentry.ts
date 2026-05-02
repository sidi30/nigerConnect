import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';

type ExtraConfig = { sentryDsn?: string };

const dsn =
  (Constants.expoConfig?.extra as ExtraConfig | undefined)?.sentryDsn ??
  process.env.EXPO_PUBLIC_SENTRY_DSN ??
  '';

let initialized = false;

/**
 * Boot Sentry with PII scrubbing turned on. Must run BEFORE the React tree
 * mounts so unhandled errors during render are captured.
 *
 * Skipped silently when no DSN is configured — the dev build keeps running
 * without phoning home.
 */
export function initSentry(): void {
  if (initialized) return;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    debug: false,
    // 0.3 in prod, 1.0 in dev — same default the API uses.
    tracesSampleRate: __DEV__ ? 1.0 : 0.3,
    sendDefaultPii: false,
    // Strip auth headers and access/refresh tokens out of breadcrumbs before
    // they leave the device. Sentry stores everything indefinitely.
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'http') {
        const data = breadcrumb.data;
        if (data && typeof data.url === 'string') {
          // Drop query strings entirely on auth-related URLs.
          if (/\/auth\/(reset-password|verify-email|google|apple)/.test(data.url)) {
            data.url = data.url.split('?')[0];
          }
        }
      }
      return breadcrumb;
    },
    beforeSend(event) {
      // Defensive scrub: remove anything that smells like a token.
      if (event.request?.headers) {
        delete event.request.headers.Authorization;
        delete event.request.headers.authorization;
        delete event.request.headers.Cookie;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });
  initialized = true;
}

/**
 * Forwarder used by `<ErrorBoundary onError={…}>` so render errors land in
 * Sentry with a `componentStack` tag.
 */
export function captureRenderError(error: Error, info: { componentStack?: string | null }): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    scope.setTag('source', 'errorBoundary');
    if (info.componentStack) scope.setExtra('componentStack', info.componentStack);
    Sentry.captureException(error);
  });
}

export { Sentry };
