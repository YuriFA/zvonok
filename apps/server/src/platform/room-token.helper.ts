import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { isParticipantRole, type ParticipantRole } from '../sfu/capabilities';

export interface RoomTokenClaims {
  roomId: string;
  projectId: string;
  keyId: string;
  participantId: string;
  name: string;
  /** Permission statement of the token; resolved to capabilities at join. */
  role: ParticipantRole;
  /** Consumer correlation fields, carried verbatim; absent when not minted. */
  externalId?: string;
  metadata?: Record<string, unknown>;
}

export type RoomTokenFailureCode = 'ROOM_TOKEN_EXPIRED' | 'ROOM_TOKEN_INVALID';

export type RoomTokenVerifyResult =
  | { ok: true; claims: RoomTokenClaims }
  | { ok: false; code: RoomTokenFailureCode };

interface DecodedRoomToken {
  sub: string;
  projectId: string;
  keyId: string;
  participantId: string;
  name: string;
  role: ParticipantRole;
  externalId?: string;
  metadata?: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDecodedRoomToken(value: unknown): value is DecodedRoomToken {
  if (!isPlainObject(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sub === 'string' &&
    typeof candidate.projectId === 'string' &&
    typeof candidate.keyId === 'string' &&
    typeof candidate.participantId === 'string' &&
    typeof candidate.name === 'string' &&
    isParticipantRole(candidate.role) &&
    (candidate.externalId === undefined ||
      typeof candidate.externalId === 'string') &&
    (candidate.metadata === undefined || isPlainObject(candidate.metadata))
  );
}

@Injectable()
export class RoomTokenHelper {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  mint(claims: RoomTokenClaims): string {
    return this.jwt.sign(
      {
        projectId: claims.projectId,
        keyId: claims.keyId,
        participantId: claims.participantId,
        name: claims.name,
        role: claims.role,
        ...(claims.externalId !== undefined && {
          externalId: claims.externalId,
        }),
        ...(claims.metadata !== undefined && { metadata: claims.metadata }),
      },
      {
        subject: claims.roomId,
        secret: this.config.get<string>('JWT_ROOM_SECRET'),
        expiresIn: `${this.ttlMinutes()}m`,
      },
    );
  }

  expiresAt(): Date {
    return new Date(Date.now() + this.ttlMinutes() * 60_000);
  }

  verify(token: string): RoomTokenVerifyResult {
    let decoded: unknown;
    try {
      decoded = this.jwt.verify(token, {
        secret: this.config.get<string>('JWT_ROOM_SECRET'),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : undefined;
      return {
        ok: false,
        code:
          name === 'TokenExpiredError'
            ? 'ROOM_TOKEN_EXPIRED'
            : 'ROOM_TOKEN_INVALID',
      };
    }

    if (!isDecodedRoomToken(decoded)) {
      return { ok: false, code: 'ROOM_TOKEN_INVALID' };
    }

    return {
      ok: true,
      claims: {
        roomId: decoded.sub,
        projectId: decoded.projectId,
        keyId: decoded.keyId,
        participantId: decoded.participantId,
        name: decoded.name,
        role: decoded.role,
        ...(decoded.externalId !== undefined && {
          externalId: decoded.externalId,
        }),
        ...(decoded.metadata !== undefined && { metadata: decoded.metadata }),
      },
    };
  }

  private ttlMinutes(): number {
    return Number(this.config.get('ROOM_TOKEN_TTL_MINUTES')) || 60;
  }
}
