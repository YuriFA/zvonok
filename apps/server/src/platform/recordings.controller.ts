import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Res,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipAuthGuard } from 'src/auth/skip-auth.guard';
import { RecordingsService } from 'src/egress/recordings.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { PlatformThrottlerGuard } from './guards/platform-throttler.guard';
import { ApiKey } from './decorators/api-key.decorator';
import type { ApiKeyContext } from './guards/api-key.guard';
import { ListRecordingsQueryDto } from './dto/platform.dto';

/** Minimal shape of the injected express response this controller needs. */
interface StreamResponse {
  status(code: number): StreamResponse;
  setHeader(name: string, value: string): void;
}

@ApiTags('platform')
@Controller('v1/recordings')
@SkipAuthGuard()
@UseGuards(ApiKeyGuard, PlatformThrottlerGuard)
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get()
  @ApiOperation({ summary: 'List recordings of the key project' })
  list(@ApiKey() key: ApiKeyContext, @Query() query: ListRecordingsQueryDto) {
    return this.recordings.list(
      key.projectId,
      query.roomId || undefined,
      query,
    );
  }

  @Get(':egressId/file')
  @ApiOperation({ summary: "Download a session's recording" })
  async download(
    @ApiKey() key: ApiKeyContext,
    @Param('egressId') egressId: string,
    @Query('part') part: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() res: StreamResponse,
  ): Promise<void> {
    const download = await this.recordings.download(key.projectId, egressId, {
      part: part === undefined || part === '' ? undefined : Number(part),
      rangeHeader: range,
    });
    if (download.range) {
      res.status(HttpStatus.PARTIAL_CONTENT);
      res.setHeader(
        'Content-Range',
        `bytes ${download.range.start}-${download.range.end}/${download.size}`,
      );
    } else {
      res.status(HttpStatus.OK);
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

  @Delete(':egressId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a session recording' })
  remove(@ApiKey() key: ApiKeyContext, @Param('egressId') egressId: string) {
    return this.recordings.remove(key.projectId, egressId);
  }
}
