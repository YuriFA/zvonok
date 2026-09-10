import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  Max,
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
