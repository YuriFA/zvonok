import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { SentryModule } from '@sentry/nestjs/setup';
import { SfuModule } from '../sfu/sfu.module';
import { ErrorReportingFilter } from './error-reporting.filter';
import { MetricsController } from './metrics.controller';
import { sfuMetricsProviders } from './sfu-metrics.providers';

/**
 * Single wiring point for production observability: the internal
 * Prometheus scrape endpoint with SFU activity gauges, and error
 * reporting to the configured Sentry-compatible backend (GlitchTip).
 */
@Module({
  imports: [
    SfuModule,
    SentryModule.forRoot(),
    PrometheusModule.register({
      path: '/metrics',
      controller: MetricsController,
    }),
  ],
  providers: [
    { provide: APP_FILTER, useClass: ErrorReportingFilter },
    ...sfuMetricsProviders,
  ],
  exports: [PrometheusModule],
})
export class ObservabilityModule {}
