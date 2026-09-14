import './observability/instrument';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { VERSION } from './version';
import { assertProductionMediaConfig } from './sfu/config/mediasoup.config';

async function bootstrap() {
  assertProductionMediaConfig();

  const app = await NestFactory.create(AppModule);

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  app.enableCors({
    origin: [clientUrl, `http://localhost:${process.env.PORT ?? 3000}`],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  configureApp(app);

  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Server v${VERSION} listening on port ${port}`);
}

void bootstrap();
