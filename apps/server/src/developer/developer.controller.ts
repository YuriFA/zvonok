import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SkipAuthGuard } from 'src/auth/skip-auth.guard';
import { JwtPayloadDto } from 'src/auth/dto/jwt-payload.dto';
import { User } from 'src/user/decorators/user.decorator';
import { DeveloperService } from './developer.service';
import { DevJwtGuard } from './guards/dev-jwt.guard';
import { DevAccount } from './decorators/dev-account.decorator';
import type { DevAccountIdentity } from './decorators/dev-account.decorator';
import {
  CreateProjectDto,
  LoginDeveloperDto,
  RegisterDeveloperDto,
  SetWebhookDto,
} from './dto/developer.dto';
import { ListQueryDto } from 'src/platform/dto/platform.dto';

/** Minimal shape of the injected express response for streaming. */
interface StreamResponse {
  status(code: number): StreamResponse;
  setHeader(name: string, value: string): void;
}

@ApiTags('developers')
@Controller('developers')
export class DeveloperController {
  constructor(private readonly developerService: DeveloperService) {}

  @Post('auth/register')
  @HttpCode(HttpStatus.CREATED)
  @SkipAuthGuard()
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a developer account' })
  register(@Body() dto: RegisterDeveloperDto) {
    return this.developerService.register(dto);
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @SkipAuthGuard()
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Login as a developer' })
  login(@Body() dto: LoginDeveloperDto) {
    return this.developerService.login(dto);
  }

  /**
   * App-session sign-in: the ONE developer route guarded by the app cookie
   * session (no @SkipAuthGuard), bridging the site identity to a linked
   * developer account.
   */
  @Post('auth/sso')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Sign in to the console with the app cookie session',
  })
  ssoFromAppSession(@User() user: JwtPayloadDto) {
    return this.developerService.ssoFromAppUser(user.id);
  }

  @Post('projects')
  @HttpCode(HttpStatus.CREATED)
  @SkipAuthGuard()
  @UseGuards(DevJwtGuard)
  @ApiOperation({ summary: 'Create a project' })
  createProject(
    @DevAccount() account: DevAccountIdentity,
    @Body() dto: CreateProjectDto,
  ) {
    return this.developerService.createProject(account.id, dto);
  }

  @Get('projects')
  @SkipAuthGuard()
  @UseGuards(DevJwtGuard)
  @ApiOperation({ summary: 'List own projects with room counts' })
  listProjects(
    @DevAccount() account: DevAccountIdentity,
    @Query() query: ListQueryDto,
  ) {
    return this.developerService.listProjects(account.id, query);
  }

  @Get('projects/:id/rooms')
  @SkipAuthGuard()
  @UseGuards(DevJwtGuard)
  @ApiOperation({ summary: "List a project's rooms" })
  listProjectRooms(
    @DevAccount() account: DevAccountIdentity,
    @Param('id') projectId: string,
    @Query() query: ListQueryDto,
  ) {
    return this.developerService.listProjectRooms(account.id, projectId, query);
  }

  @Get('projects/:id/recordings')
  @SkipAuthGuard()
  @UseGuards(DevJwtGuard)
  @ApiOperation({ summary: "List a project's recordings" })
  listProjectRecordings(
    @DevAccount() account: DevAccountIdentity,
    @Param('id') projectId: string,
    @Query() query: ListQueryDto,
  ) {
    return this.developerService.listProjectRecordings(
      account.id,
      projectId,
      query,
    );
  }

  @Get('projects/:id/recordings/:egressId/file')
  @SkipAuthGuard()
  @UseGuards(DevJwtGuard)
  @ApiOperation({ summary: "Download a project's recording" })
  async downloadProjectRecording(
    @DevAccount() account: DevAccountIdentity,
    @Param('id') projectId: string,
    @Param('egressId') egressId: string,
    @Query('part') part: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() res: StreamResponse,
  ): Promise<void> {
    const download = await this.developerService.downloadProjectRecording(
      account.id,
      projectId,
      egressId,
      {
        part: part === undefined || part === '' ? undefined : Number(part),
        rangeHeader: range,
      },
    );
    if (download.range) {
      res.status(HttpStatus.PARTIAL_CONTENT);
      res.setHeader(
        'Content-Range',
        `bytes ${download.range.start}-${download.range.end}/${download.size}`,
      );
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', download.contentType);
    res.setHeader(
      'Content-Length',
      String(
        download.range
          ? download.range.end - download.range.start + 1
          : download.size,
      ),
    );
    download.stream.pipe(res as unknown as NodeJS.WritableStream);
  }

  @Post('projects/:id/keys')
  @HttpCode(HttpStatus.CREATED)
  @SkipAuthGuard()
  @UseGuards(DevJwtGuard)
  @ApiOperation({ summary: 'Create an API key (full key shown once)' })
  createApiKey(
    @DevAccount() account: DevAccountIdentity,
    @Param('id') projectId: string,
  ) {
    return this.developerService.createApiKey(account.id, projectId);
  }

  @Get('projects/:id/keys')
  @SkipAuthGuard()
  @UseGuards(DevJwtGuard)
  @ApiOperation({ summary: 'List API keys (metadata only)' })
  listApiKeys(
    @DevAccount() account: DevAccountIdentity,
    @Param('id') projectId: string,
  ) {
    return this.developerService.listApiKeys(account.id, projectId);
  }

  @Delete('keys/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipAuthGuard()
  @UseGuards(DevJwtGuard)
  @ApiOperation({ summary: 'Revoke an API key' })
  async revokeApiKey(
    @DevAccount() account: DevAccountIdentity,
    @Param('id') keyId: string,
  ) {
    await this.developerService.revokeApiKey(account.id, keyId);
  }

  @Put('projects/:id/webhooks')
  @SkipAuthGuard()
  @UseGuards(DevJwtGuard)
  @ApiOperation({
    summary:
      'Set or replace the project webhook endpoint (signing secret returned)',
  })
  setWebhook(
    @DevAccount() account: DevAccountIdentity,
    @Param('id') projectId: string,
    @Body() dto: SetWebhookDto,
  ) {
    return this.developerService.setWebhook(account.id, projectId, dto.url);
  }

  @Delete('projects/:id/webhooks')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipAuthGuard()
  @UseGuards(DevJwtGuard)
  @ApiOperation({ summary: 'Remove the project webhook endpoint' })
  async removeWebhook(
    @DevAccount() account: DevAccountIdentity,
    @Param('id') projectId: string,
  ) {
    await this.developerService.removeWebhook(account.id, projectId);
  }
}
