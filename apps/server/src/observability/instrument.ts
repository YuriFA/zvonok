import * as Sentry from '@sentry/nestjs';

/**
 * Strip secrets from outgoing error events. The SDK's built-in denylist
 * already filters body keys like `password` and `auth` ("[Filtered]");
 * this removes transport-level credentials the denylist does not touch.
 */
export function scrubErrorEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const request = event.request;
  if (!request) {
    return event;
  }
  delete request.cookies;
  if (request.headers) {
    delete request.headers.authorization;
    delete request.headers.cookie;
  }
  return event;
}

/**
 * Initialize error reporting only when a DSN is configured. Reads
 * process.env directly because this runs before ConfigModule loads
 * dotfiles: in production the DSN is a real compose environment variable.
 * Without a DSN the SDK stays uninitialized and every capture call is an
 * inert no-op.
 */
export function initErrorReporting(
  env: Record<string, string | undefined> = process.env,
): void {
  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    return;
  }
  Sentry.init({
    dsn,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
    beforeSend: scrubErrorEvent,
  });
}

initErrorReporting();
