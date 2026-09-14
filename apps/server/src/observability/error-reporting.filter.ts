import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';

/**
 * Global catch-all: mirrors Nest's default error responses while reporting
 * server faults to the configured Sentry-compatible backend (GlitchTip).
 * Client errors (4xx HttpExceptions) are control flow, not faults: only
 * non-HttpException throws and 5xx responses are reported. With no DSN
 * configured, captureException is a disabled no-op.
 */
@Catch()
export class ErrorReportingFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reportable =
      !(exception instanceof HttpException) || exception.getStatus() >= 500;
    if (reportable) {
      Sentry.captureException(exception);
    }
    return super.catch(exception, host);
  }
}
