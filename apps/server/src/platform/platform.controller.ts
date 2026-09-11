import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SkipAuthGuard } from 'src/auth/skip-auth.guard';
import { PlatformService } from './platform.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { PlatformThrottlerGuard } from './guards/platform-throttler.guard';
import { ApiKey } from './decorators/api-key.decorator';
import type { ApiKeyContext } from './guards/api-key.guard';
import {
  CreatePlatformRoomDto,
  ListQueryDto,
  MintRoomTokenDto,
  StartEgressDto,
} from './dto/platform.dto';

@ApiTags('platform')
@Controller('v1')
@SkipAuthGuard()
@UseGuards(ApiKeyGuard, PlatformThrottlerGuard)
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Post('rooms')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Create a room owned by the key project' })
  createRoom(@ApiKey() key: ApiKeyContext, @Body() dto: CreatePlatformRoomDto) {
    return this.platformService.createRoom(key.projectId, dto);
  }

  @Get('rooms')
  @ApiOperation({ summary: 'List rooms of the key project' })
  listRooms(@ApiKey() key: ApiKeyContext, @Query() query: ListQueryDto) {
    return this.platformService.listRooms(key.projectId, query);
  }

  @Delete('rooms/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End a project room' })
  async endRoom(@ApiKey() key: ApiKeyContext, @Param('id') roomId: string) {
    await this.platformService.endRoom(key.projectId, roomId);
  }

  @Post('rooms/:id/tokens')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Mint a short-lived participant room token' })
  mintRoomToken(
    @ApiKey() key: ApiKeyContext,
    @Param('id') roomId: string,
    @Body() dto: MintRoomTokenDto,
  ) {
    return this.platformService.mintRoomToken(
      key.projectId,
      key.id,
      roomId,
      dto,
    );
  }

  @Post('rooms/:id/egress')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Start an egress session for a project room' })
  startEgress(
    @ApiKey() key: ApiKeyContext,
    @Param('id') roomId: string,
    @Body() dto: StartEgressDto,
  ) {
    return this.platformService.startEgress(key.projectId, roomId, dto);
  }

  @Get('rooms/:id/egress')
  @ApiOperation({ summary: "List a project room's egress sessions" })
  listEgress(
    @ApiKey() key: ApiKeyContext,
    @Param('id') roomId: string,
    @Query() query: ListQueryDto,
  ) {
    return this.platformService.listEgress(key.projectId, roomId, query);
  }

  @Get('egress/:id')
  @ApiOperation({ summary: 'Inspect an egress session' })
  getEgress(@ApiKey() key: ApiKeyContext, @Param('id') egressId: string) {
    return this.platformService.getEgress(key.projectId, egressId);
  }

  @Post('egress/:id/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop an active egress session' })
  stopEgress(@ApiKey() key: ApiKeyContext, @Param('id') egressId: string) {
    return this.platformService.stopEgress(key.projectId, egressId);
  }
}
