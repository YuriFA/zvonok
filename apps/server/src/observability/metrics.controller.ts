import { Controller, Get, Res } from '@nestjs/common';
import { PrometheusController } from '@willsoto/nestjs-prometheus';
import type { Response } from 'express';
import { SkipAuthGuard } from '../auth/skip-auth.guard';

/**
 * Internal-only Prometheus scrape endpoint. The global JwtAuthGuard would
 * reject the unauthenticated scraper, and by design there is no public
 * gateway route to this path: only the monitoring stack on the host
 * network may reach it.
 */
@Controller()
@SkipAuthGuard()
export class MetricsController extends PrometheusController {
  @Get()
  async index(@Res({ passthrough: true }) response: Response) {
    return super.index(response);
  }
}
