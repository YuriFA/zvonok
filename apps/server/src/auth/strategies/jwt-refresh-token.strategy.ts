import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { UserService } from 'src/user/user.service';
import { RefreshTokenHelper } from '../helpers/refresh-token.helper';
import type { Role } from 'src/generated/prisma/enums';

interface JwtPayload {
  id: string;
  email: string;
  role?: Role;
  jti?: string;
  tokenVersion?: number;
}

const cookieExtractor = (req: Request) => {
  if (!req || !req.cookies) return null;
  return req.cookies['refresh_token'] as string;
};

@Injectable()
export class JwtRefreshTokenStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh-token',
) {
  private readonly logger = new Logger(JwtRefreshTokenStrategy.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_REFRESH_SECRET')!,
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    if (!payload?.jti) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const cookieToken = req?.cookies?.['refresh_token'] as string | undefined;
    const authHeader = req?.headers?.authorization;
    const headerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
    const refreshToken = cookieToken ?? headerToken;

    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const user = await this.userService.user({ id: payload.id });

    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Validate token version
    if (
      payload.tokenVersion !== undefined &&
      payload.tokenVersion !== user.tokenVersion
    ) {
      this.logger.warn('Invalid token version', {
        userId: user.id,
        email: user.email,
        tokenVersion: payload.tokenVersion,
        currentTokenVersion: user.tokenVersion,
      });
      throw new UnauthorizedException('Token has been revoked');
    }

    const isRefreshTokenValid = RefreshTokenHelper.compare(
      refreshToken,
      user.refreshTokenHash,
    );

    if (!isRefreshTokenValid) {
      await this.userService.updateRefreshTokenHash(user.id, null);
      this.logger.warn('Refresh token reuse detected', {
        userId: user.id,
        email: user.email,
      });
      throw new UnauthorizedException({
        message: 'Refresh token reuse detected',
        code: 'REFRESH_REUSE_DETECTED',
      });
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
  }
}
