import { Module } from '@nestjs/common';
import { SfuModule } from 'src/sfu/sfu.module';
import { SfuService } from 'src/sfu/sfu.service';
import { ROOM_MEDIA_SOURCE } from 'src/sfu/room-media-source.port';
import { WebhooksModule } from 'src/webhooks/webhooks.module';
import { EGRESS_HLS_DIR } from './egress.config';
import { EGRESS_HLS_ROOT } from './egress-playback.controller';
import { EgressPlaybackController } from './egress-playback.controller';
import { EgressService } from './egress.service';
import { EgressSignalGateway } from './egress-signal.gateway';
import { RecordingsService } from './recordings.service';

@Module({
  imports: [SfuModule, WebhooksModule],
  controllers: [EgressPlaybackController],
  providers: [
    EgressService,
    EgressSignalGateway,
    RecordingsService,
    { provide: ROOM_MEDIA_SOURCE, useExisting: SfuService },
    { provide: EGRESS_HLS_ROOT, useValue: EGRESS_HLS_DIR },
  ],
  exports: [EgressService, RecordingsService],
})
export class EgressModule {}
