import { makeGaugeProvider } from '@willsoto/nestjs-prometheus';
import { RoomPresenceService } from '../sfu/room-presence.service';
import { SfuService } from '../sfu/sfu.service';
import { WorkerManager } from '../sfu/worker-manager';

/**
 * SFU call-activity gauges. Values are read from live in-process state at
 * scrape time (collect callbacks) - no polling, no cached counters. The
 * state sources are the same structures the SFU already maintains: the
 * worker manager's router map, the presence service's peer records, and
 * the SFU service's open transports.
 */
export const sfuMetricsProviders = [
  makeGaugeProvider({
    name: 'zvonok_sfu_active_rooms',
    help: 'Rooms with a live SFU router',
    inject: [WorkerManager],
    collect(workerManager: WorkerManager) {
      this.set(workerManager.liveRouterCount());
    },
  }),
  makeGaugeProvider({
    name: 'zvonok_sfu_connected_peers',
    help: 'Peers currently tracked in rooms',
    inject: [RoomPresenceService],
    collect(presence: RoomPresenceService) {
      this.set(presence.peerCount());
    },
  }),
  makeGaugeProvider({
    name: 'zvonok_sfu_open_transports',
    help: 'Open WebRTC transports across all peers',
    inject: [SfuService],
    collect(sfu: SfuService) {
      this.set(sfu.openTransportCount());
    },
  }),
];
