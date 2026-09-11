import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
  ValidateIf,
  Length,
  registerDecorator,
} from 'class-validator';

import {
  PARTICIPANT_ROLES,
  type ParticipantRole,
} from '../../sfu/capabilities';

export class CreatePlatformRoomDto {
  @ApiProperty({ required: false, type: 'string', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false, default: 10, minimum: 2, maximum: 50 })
  @IsOptional()
  @Min(2)
  @Max(50)
  maxParticipants?: number;
}

export class MintRoomTokenDto {
  @ApiProperty({
    required: false,
    type: 'string',
    description: 'Participant display name',
    example: 'Alice',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @ApiProperty({
    required: false,
    type: 'string',
    enum: PARTICIPANT_ROLES,
    default: 'participant',
    description:
      'Role of the participant: host, participant, or viewer. The server resolves the role to capabilities at join time',
  })
  @IsOptional()
  @IsIn(PARTICIPANT_ROLES)
  role?: ParticipantRole;
  @ApiProperty({
    required: false,
    type: 'string',
    minLength: 1,
    maxLength: 64,
    description:
      'Consumer-side participant id carried verbatim through the token, peer events and webhooks',
    example: 'user-42',
  })
  @IsOptional()
  @ValidateIf((o) => o.externalId !== undefined)
  @IsString()
  @Length(1, 64)
  externalId?: string;

  @ApiProperty({
    required: false,
    type: Object,
    description:
      'Consumer-owned correlation data (JSON object, at most 2048 bytes serialized), carried verbatim',
    example: { tenant: 'acme', avatar: 'https://cdn.example.com/a.png' },
  })
  @ValidateIf((o) => o.metadata !== undefined)
  @IsJsonObject()
  @MaxSerializedSize(2048)
  metadata?: Record<string, unknown>;
}

/**
 * Size guard for consumer-owned JSON blobs riding inside the minted JWT:
 * rejects any value whose serialized form exceeds `maxBytes`.
 */
function MaxSerializedSize(maxBytes: number) {
  return (target: object, propertyKey: string) => {
    registerDecorator({
      name: 'maxSerializedSize',
      target: target.constructor,
      propertyName: propertyKey,
      constraints: [maxBytes],
      options: {
        message: `${propertyKey} must serialize to at most ${maxBytes} bytes`,
      },
      validator: {
        validate(value: unknown): boolean {
          return JSON.stringify(value).length <= maxBytes;
        },
      },
    });
  };
}

/**
 * class-validator's IsObject accepts null and arrays (both typeof "object");
 * correlation metadata must be a JSON object only.
 */
function IsJsonObject() {
  return (target: object, propertyKey: string) => {
    registerDecorator({
      name: 'isJsonObject',
      target: target.constructor,
      propertyName: propertyKey,
      options: { message: `${propertyKey} must be a JSON object` },
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'object' && value !== null && !Array.isArray(value)
          );
        },
      },
    });
  };
}

export class StartEgressDto {
  @ApiProperty({
    required: false,
    type: 'array',
    items: { type: 'string' },
    maxItems: 3,
    description: 'RTMP(S) push endpoints (1-3)',
    example: ['rtmp://a.rtmp.youtube.com/live2'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @Matches(/^rtmps?:\/\//, {
    each: true,
    message: 'each endpoint must use the rtmp or rtmps scheme',
  })
  @MaxLength(2048, { each: true })
  rtmpEndpoints?: string[];

  @ApiProperty({
    required: false,
    type: 'boolean',
    default: false,
    description: 'Write a live HLS playlist served by the server',
  })
  @IsOptional()
  @IsBoolean()
  hls?: boolean;

  @ApiProperty({
    required: false,
    type: 'boolean',
    default: false,
    description: 'Record the program to server disk for later download',
  })
  @IsOptional()
  @IsBoolean()
  record?: boolean;
}

export class ListQueryDto {
  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 100,
    default: 50,
    description: 'Page size; values outside 1..100 answer 400',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiProperty({
    required: false,
    type: 'string',
    description:
      'Opaque continuation cursor taken from a previous response next field',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class ListRecordingsQueryDto extends ListQueryDto {
  @ApiProperty({
    required: false,
    type: 'string',
    description: 'Restrict the listing to one room',
  })
  @IsOptional()
  @IsString()
  roomId?: string;
}
