import { Module } from '@nestjs/common';
import { SfuService } from './sfu.service';
import { SfuGateway } from './sfu.gateway';
import { WorkerManager } from './worker-manager';
import { RoomTokenHelper } from '../platform/room-token.helper';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { RoomPresenceService } from './room-presence.service';
import { ROOM_PRESENCE } from './room-presence.port';

@Module({
  imports: [WebhooksModule],
  providers: [
    SfuService,
    SfuGateway,
    WorkerManager,
    RoomTokenHelper,
    RoomPresenceService,
    { provide: ROOM_PRESENCE, useExisting: RoomPresenceService },
  ],
  exports: [SfuService, SfuGateway, RoomPresenceService, ROOM_PRESENCE],
})
export class SfuModule {}
