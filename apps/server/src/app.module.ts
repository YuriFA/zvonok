import { Module } from '@nestjs/common';
import { UserModule } from './user/user.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { RoomModule } from './room/room.module';
import { ChatModule } from './chat/chat.module';
import { SfuModule } from './sfu/sfu.module';
import { PlatformModule } from './platform/platform.module';
import { EgressModule } from './egress/egress.module';
import { DeveloperModule } from './developer/developer.module';
import { WhiteboardModule } from './whiteboard/whiteboard.module';
import { ObservabilityModule } from './observability/observability.module';
import { VersionController } from './version.controller';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '.env.development',
      isGlobal: true,
      validate: (config) => {
        const required = [
          'DATABASE_URL',
          'JWT_ACCESS_SECRET',
          'JWT_REFRESH_SECRET',
          'JWT_DEV_SECRET',
          'JWT_ROOM_SECRET',
          'JWT_ACCESS_EXPIRES_IN_MINUTES',
          'JWT_REFRESH_EXPIRES_IN_DAYS',
        ];
        const missing = required.filter((key) => !config[key]);
        if (missing.length > 0) {
          throw new Error(
            `Missing required environment variables: ${missing.join(', ')}`,
          );
        }

        const accessMinutes = Number(config.JWT_ACCESS_EXPIRES_IN_MINUTES);
        const refreshDays = Number(config.JWT_REFRESH_EXPIRES_IN_DAYS);

        if (Number.isNaN(accessMinutes) || accessMinutes <= 0) {
          throw new Error('JWT_ACCESS_EXPIRES_IN_MINUTES must be a number > 0');
        }

        if (Number.isNaN(refreshDays) || refreshDays <= 0) {
          throw new Error('JWT_REFRESH_EXPIRES_IN_DAYS must be a number > 0');
        }

        return config;
      },
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000,
        limit: 100,
      },
      {
        name: 'medium',
        ttl: 300000,
        limit: 200,
      },
      {
        name: 'long',
        ttl: 3600000,
        limit: 1000,
      },
    ]),
    PrismaModule,
    AuthModule,
    UserModule,
    RoomModule,
    ChatModule,
    SfuModule,
    DeveloperModule,
    PlatformModule,
    EgressModule,
    WhiteboardModule,
    ObservabilityModule,
  ],
  controllers: [VersionController],
  providers: [
    // ThrottlerGuard must be registered before JwtAuthGuard (provided by AuthModule)
    // so rate-limit headers are always emitted, even for unauthenticated requests.
    // NestJS applies APP_GUARD tokens in registration order: root module providers
    // are collected before child module providers, preserving this order.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
