jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import type { Socket } from 'socket.io';
import type {
  AppData,
  PlainTransport,
  Router,
  RtpCapabilities,
  RtpParameters,
  WebRtcTransport,
} from 'mediasoup/types';
import { NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { SfuService } from './sfu.service';
import { RoomPresenceService } from './room-presence.service';
import { ROOM_PRESENCE } from './room-presence.port';
import { capabilitiesForRole, type ParticipantRole } from './capabilities';
import type { Producer } from 'mediasoup/types';
import { WorkerManager } from './worker-manager';
import type { Peer, SfuJoinPayload } from './interfaces/sfu.interface';
import { RoomTokenHelper } from '../platform/room-token.helper';
import { PrismaService } from 'src/prisma/prisma.service';
import type {
  RoomTokenClaims,
  RoomTokenVerifyResult,
} from '../platform/room-token.helper';
import { WebhookDispatcher } from '../webhooks/webhook-dispatcher.service';
import { config as mediasoupConfig } from './config/mediasoup.config';
import type { RoomTapDescriptor } from './room-media-source.port';

let presence: RoomPresenceService;

type PresenceHarness = {
  records: Map<string, Record<string, unknown>>;
  rooms: Map<string, Set<string>>;
  roomOwners: Map<string, string>;
  roomLocks: Map<string, boolean>;
  roomClosedHandlers: Map<string, Set<() => void>>;
  peerDetachHandlers: Map<string, Set<() => void>>;
};

/**
 * The tests seed the historical single-map shape (`peers`, `rooms`,
 * `roomOwners` on the service). After the presence split that state lives in
 * RoomPresenceService (identity, membership) and SfuService.media
 * (transports, producers, consumers); attach split views under the old names
 * so the white-box seeds keep working unchanged.
 */
function attachSplitState(
  service: SfuService,
  presence: RoomPresenceService,
): void {
  const presenceState = presence as unknown as PresenceHarness;
  const mediaState = service as unknown as {
    media: Map<string, Record<string, unknown>>;
    detachMedia: (socketId: string) => void;
    closeRoomMedia: (roomId: string) => void;
    routerRooms: Set<string>;
  };
  const peersView = {
    set(socketId: string, peer: Record<string, unknown>) {
      const roomId = (peer.roomId as string) ?? 'room-1';
      presenceState.records.set(socketId, {
        socketId,
        roomId,
        userId: peer.userId,
        username: peer.username,
        externalId: peer.externalId,
        metadata: peer.metadata,
        capabilities: (peer.capabilities as string[]) ?? [],
        ownsRoom: peer.ownsRoom as boolean | undefined,
        socket: peer.socket,
      });
      let members = presenceState.rooms.get(roomId);
      if (!members) {
        members = new Set();
        presenceState.rooms.set(roomId, members);
      }
      members.add(socketId);
      mediaState.media.set(socketId, {
        sendTransport: peer.sendTransport,
        recvTransport: peer.recvTransport,
        producers: peer.producers ?? new Map(),
        consumers: peer.consumers ?? new Map(),
      });
      // Mirror joinRoom's wiring so seeded peers detach and their rooms
      // tear down like real ones.
      presenceState.peerDetachHandlers.set(
        socketId,
        new Set([() => mediaState.detachMedia(socketId)]),
      );
      if (!mediaState.routerRooms.has(roomId)) {
        mediaState.routerRooms.add(roomId);
        if (!presenceState.roomClosedHandlers.has(roomId)) {
          presenceState.roomClosedHandlers.set(roomId, new Set());
        }
        presenceState.roomClosedHandlers
          .get(roomId)!
          .add(() => mediaState.closeRoomMedia(roomId));
      }
      return peersView;
    },
    get(socketId: string) {
      const media = mediaState.media.get(socketId);
      const identity = presenceState.records.get(socketId);
      if (!identity) return media;
      return { ...media, ...identity };
    },
    values() {
      return Array.from(presenceState.records.keys(), (socketId) =>
        peersView.get(socketId),
      )[Symbol.iterator]();
    },
    has(socketId: string) {
      return presenceState.records.has(socketId);
    },
  };
  Object.assign(service, {
    peers: peersView,
    rooms: presenceState.rooms,
    roomOwners: presenceState.roomOwners,
    roomLocks: presenceState.roomLocks,
  });
}

type SfuServiceState = {
  peers: Map<string, unknown>;
};
let service: SfuService;
let workerManager: jest.Mocked<WorkerManager>;
let roomTokenHelper: RoomTokenHelper;
let jwtService: { verify: jest.Mock };
let config: { get: jest.Mock };
let prisma: {
  apiKey: { findUnique: jest.Mock };
  room: { findUnique: jest.Mock };
  user: { findUnique: jest.Mock };
};
let webhooks: {
  roomStarted: jest.Mock;
  participantJoined: jest.Mock;
  participantLeft: jest.Mock;
  roomEnded: jest.Mock;
};
const socket = {
  id: 'socket-1',
  emit: jest.fn(),
  handshake: { auth: {}, headers: {} },
} as unknown as Socket;
const createSocket = (id: string) =>
  ({
    id,
    emit: jest.fn(),
    disconnect: jest.fn(),
    handshake: { auth: { token: 'access-jwt' }, headers: {} },
  }) as unknown as Socket;

beforeEach(async () => {
  roomTokenHelper = { verify: jest.fn() } as unknown as RoomTokenHelper;
  jwtService = { verify: jest.fn() };
  config = {
    get: jest.fn((key: string) =>
      key === 'CLIENT_URL' ? 'http://localhost:5173' : undefined,
    ),
  };
  prisma = {
    apiKey: { findUnique: jest.fn() },
    room: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  webhooks = {
    roomStarted: jest.fn(),
    participantJoined: jest.fn(),
    participantLeft: jest.fn(),
    roomEnded: jest.fn(),
  };

  // Default verified identity for handshake joins: user-1 (alice) joining a
  // room she owns. Individual tests override these mocks as needed.
  jwtService.verify.mockReturnValue({ id: 'user-1' });
  prisma.user.findUnique.mockResolvedValue({ username: 'alice' });
  prisma.room.findUnique.mockResolvedValue({
    slug: 'abc123',
    ownerId: 'user-1',
  });

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SfuService,
      RoomPresenceService,
      {
        provide: WorkerManager,
        useValue: {
          createRouter: jest.fn(),
          getRtpCapabilities: jest.fn(),
          getRouter: jest.fn(),
          closeRouter: jest.fn(),
        },
      },
      { provide: RoomTokenHelper, useValue: roomTokenHelper },
      { provide: PrismaService, useValue: prisma },
      { provide: WebhookDispatcher, useValue: webhooks },
      { provide: JwtService, useValue: jwtService },
      { provide: ConfigService, useValue: config },
      { provide: ROOM_PRESENCE, useExisting: RoomPresenceService },
    ],
  }).compile();

  service = module.get<SfuService>(SfuService);
  workerManager = module.get(WorkerManager);
  presence = module.get(RoomPresenceService);
  attachSplitState(service, presence);
  (socket.emit as jest.Mock).mockReset();
  socket.handshake.auth = { token: 'access-jwt' };
});

it('joins a room and emits RTP capabilities', async () => {
  const routerRtpCapabilities = { codecs: [] } as unknown as RtpCapabilities;
  workerManager.createRouter.mockResolvedValue({} as Router<AppData>);
  workerManager.getRtpCapabilities.mockReturnValue(routerRtpCapabilities);
  await service.joinRoom(socket, {
    roomId: 'room-1',
  });
  expect(workerManager.createRouter).toHaveBeenCalledWith('room-1');
  expect(socket.emit).toHaveBeenCalledWith('sfu:joined', {
    routerRtpCapabilities,
    participant: { id: 'user-1', username: 'alice' },
    capabilities: capabilitiesForRole('host'),
  });
});

it('creates a send transport and exposes its direction in the payload', async () => {
  const transport = {
    id: 'send-1',
    iceParameters: {
      usernameFragment: 'user',
      password: 'pass',
      iceLite: true,
    },
    iceCandidates: [],
    dtlsParameters: { fingerprints: [], role: 'auto' },
  } as unknown as WebRtcTransport;
  const router = {
    createWebRtcTransport: jest.fn().mockResolvedValue(transport),
  } as { createWebRtcTransport: jest.Mock };

  workerManager.createRouter.mockResolvedValue({} as Router<AppData>);
  workerManager.getRtpCapabilities.mockReturnValue(
    {} as unknown as RtpCapabilities,
  );
  workerManager.getRouter.mockReturnValue(router as unknown as Router<AppData>);

  await service.joinRoom(socket, {
    roomId: 'room-1',
  });
  (socket.emit as jest.Mock).mockReset();

  await service.createSendTransport(socket);

  expect(router.createWebRtcTransport).toHaveBeenCalled();
  expect(socket.emit).toHaveBeenCalledWith('sfu:transport-created', {
    direction: 'send',
    transportId: 'send-1',
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
    iceServers: [
      {
        urls: [
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
        ],
      },
    ],
  });
});

it('connects a matching transport with client DTLS parameters', async () => {
  const connect = jest.fn().mockResolvedValue(undefined);
  const peer = {
    id: socket.id,
    userId: 'user-1',
    username: 'alice',
    socket,
    sendTransport: { id: 'send-1', connect } as unknown as WebRtcTransport,
    producers: new Map(),
    consumers: new Map(),
    capabilities: capabilitiesForRole('participant'),
  } satisfies Peer;

  const serviceState = service as unknown as SfuServiceState;
  serviceState.peers.set(socket.id, peer);

  await service.connectTransport(socket, {
    transportId: 'send-1',
    dtlsParameters: { fingerprints: [], role: 'client' },
  });

  expect(connect).toHaveBeenCalledWith({
    dtlsParameters: { fingerprints: [], role: 'client' },
  });
  expect(socket.emit).toHaveBeenCalledWith('sfu:transport-connected', {
    transportId: 'send-1',
  });
});

it('resumes a paused consumer after client acknowledgement', async () => {
  const resume = jest.fn().mockResolvedValue(undefined);
  const peer = {
    id: socket.id,
    userId: 'user-1',
    username: 'alice',
    socket,
    producers: new Map(),
    consumers: new Map([['consumer-1', { resume }]]),
  };

  const serviceState = service as unknown as SfuServiceState;
  serviceState.peers.set(socket.id, peer);

  await service.resumeConsumer(socket, 'consumer-1');

  expect(resume).toHaveBeenCalled();
  expect(socket.emit).toHaveBeenCalledWith('sfu:consumer-resumed', {
    consumerId: 'consumer-1',
  });
});

it('announces existing producers when a recv transport is created', async () => {
  const producer = {
    id: 'producer-1',
    kind: 'video',
    paused: false,
    appData: {},
  };
  const recvTransport = {
    id: 'recv-1',
    iceParameters: {
      usernameFragment: 'user',
      password: 'pass',
      iceLite: true,
    },
    iceCandidates: [],
    dtlsParameters: { fingerprints: [], role: 'auto' },
  } as unknown as WebRtcTransport;
  const router = {
    createWebRtcTransport: jest.fn().mockResolvedValue(recvTransport),
  } as { createWebRtcTransport: jest.Mock };

  const existingSocket = createSocket('socket-2');
  const serviceState = service as unknown as {
    peers: Map<
      string,
      {
        id: string;
        userId: string;
        username: string;
        socket: Socket;
        recvTransport?: WebRtcTransport;
        producers: Map<string, typeof producer>;
        consumers: Map<string, unknown>;
        capabilities: string[];
      }
    >;
    rooms: Map<string, Set<string>>;
  };

  serviceState.peers.set(existingSocket.id, {
    id: existingSocket.id,
    userId: 'user-2',
    username: 'bob',
    socket: existingSocket,
    recvTransport,
    producers: new Map([['producer-1', producer]]),
    consumers: new Map(),
    capabilities: capabilitiesForRole('participant'),
  });

  workerManager.createRouter.mockResolvedValue({} as Router<AppData>);
  workerManager.getRtpCapabilities.mockReturnValue(
    {} as unknown as RtpCapabilities,
  );
  workerManager.getRouter.mockReturnValue(router as unknown as Router<AppData>);

  await service.joinRoom(socket, {
    roomId: 'room-1',
  });

  serviceState.rooms.set('room-1', new Set([socket.id, existingSocket.id]));
  (socket.emit as jest.Mock).mockReset();

  await service.createRecvTransport(socket);

  expect(socket.emit).toHaveBeenCalledWith('sfu:new-producer', {
    producerId: 'producer-1',
    userId: 'user-2',
    username: 'bob',
    kind: 'video',
    paused: false,
    appData: {},
  });
});

it('notifies other peers when a peer leaves the room', async () => {
  const otherSocket = createSocket('socket-2');
  const serviceState = service as unknown as {
    peers: Map<
      string,
      {
        id: string;
        userId: string;
        username: string;
        socket: Socket;
        producers: Map<string, unknown>;
        consumers: Map<string, unknown>;
        capabilities: string[];
      }
    >;
    rooms: Map<string, Set<string>>;
    roomOwners: Map<string, string>;
  };

  serviceState.peers.set(socket.id, {
    id: socket.id,
    userId: 'user-1',
    username: 'alice',
    socket,
    producers: new Map(),
    consumers: new Map(),
    capabilities: capabilitiesForRole('participant'),
  });
  serviceState.peers.set(otherSocket.id, {
    id: otherSocket.id,
    userId: 'user-2',
    username: 'bob',
    socket: otherSocket,
    producers: new Map(),
    consumers: new Map(),
    capabilities: capabilitiesForRole('participant'),
  });
  serviceState.rooms.set('room-1', new Set([socket.id, otherSocket.id]));

  await service.leaveRoom(socket);

  expect(otherSocket.emit).toHaveBeenCalledWith('sfu:peer-left', {
    userId: 'user-1',
  });
});

it('allows the room owner to kick another peer', async () => {
  const ownerSocket = createSocket('socket-owner');
  const targetSocket = {
    ...createSocket('socket-target'),
    disconnect: jest.fn(),
  } as unknown as Socket & { disconnect: jest.Mock };
  const serviceState = service as unknown as {
    peers: Map<
      string,
      {
        id: string;
        userId: string;
        username: string;
        socket: Socket;
        producers: Map<string, unknown>;
        consumers: Map<string, unknown>;
        capabilities: string[];
      }
    >;
    rooms: Map<string, Set<string>>;
    roomOwners: Map<string, string>;
  };

  serviceState.peers.set(ownerSocket.id, {
    id: ownerSocket.id,
    userId: 'user-1',
    username: 'alice',
    socket: ownerSocket,
    producers: new Map(),
    consumers: new Map(),
    capabilities: capabilitiesForRole('host'),
  });
  serviceState.peers.set(targetSocket.id, {
    id: targetSocket.id,
    userId: 'user-2',
    username: 'bob',
    socket: targetSocket,
    producers: new Map(),
    consumers: new Map(),
    capabilities: capabilitiesForRole('participant'),
  });
  serviceState.rooms.set('room-1', new Set([ownerSocket.id, targetSocket.id]));
  serviceState.roomOwners.set('room-1', 'user-1');

  await service.kickPeer(ownerSocket, 'user-2');

  expect(targetSocket.emit).toHaveBeenCalledWith('sfu:kicked', {
    roomId: 'room-1',
  });
  expect(targetSocket.disconnect).toHaveBeenCalled();
  expect(ownerSocket.emit).toHaveBeenCalledWith('sfu:peer-left', {
    userId: 'user-2',
  });
});

it('emits sfu:room-ended to all peers and cleans up when a room is ended', async () => {
  const socket1 = createSocket('socket-1');
  const socket2 = createSocket('socket-2');
  const serviceState = service as unknown as {
    peers: Map<
      string,
      {
        id: string;
        userId: string;
        username: string;
        socket: Socket;
        sendTransport?: { close: jest.Mock };
        recvTransport?: { close: jest.Mock };
        producers: Map<string, unknown>;
        consumers: Map<string, unknown>;
        capabilities: string[];
      }
    >;
    rooms: Map<string, Set<string>>;
    roomOwners: Map<string, string>;
  };

  const sendClose1 = jest.fn();
  const recvClose1 = jest.fn();
  const sendClose2 = jest.fn();

  serviceState.peers.set(socket1.id, {
    id: socket1.id,
    userId: 'user-1',
    username: 'alice',
    socket: socket1,
    sendTransport: { close: sendClose1 },
    recvTransport: { close: recvClose1 },
    producers: new Map(),
    consumers: new Map(),
    capabilities: capabilitiesForRole('participant'),
  });
  serviceState.peers.set(socket2.id, {
    id: socket2.id,
    userId: 'user-2',
    username: 'bob',
    socket: socket2,
    sendTransport: { close: sendClose2 },
    producers: new Map(),
    consumers: new Map(),
    capabilities: capabilitiesForRole('participant'),
  });
  serviceState.rooms.set('room-1', new Set([socket1.id, socket2.id]));
  serviceState.roomOwners.set('room-1', 'user-1');

  await service.endRoom('room-1');

  expect(socket1.emit).toHaveBeenCalledWith('sfu:room-ended', {
    roomId: 'room-1',
  });
  expect(socket2.emit).toHaveBeenCalledWith('sfu:room-ended', {
    roomId: 'room-1',
  });
  expect(sendClose1).toHaveBeenCalled();
  expect(recvClose1).toHaveBeenCalled();
  expect(sendClose2).toHaveBeenCalled();
  expect(workerManager.closeRouter).toHaveBeenCalledWith('room-1');

  expect(serviceState.rooms.has('room-1')).toBe(false);
  expect(serviceState.roomOwners.has('room-1')).toBe(false);
  expect(serviceState.peers.has(socket1.id)).toBe(false);
  expect(serviceState.peers.has(socket2.id)).toBe(false);
});

it('handles endRoom gracefully when room has no SFU peers', async () => {
  await service.endRoom('nonexistent-room');
  expect(workerManager.closeRouter).not.toHaveBeenCalled();
});

describe('screen share', () => {
  const serviceState = () =>
    service as unknown as {
      peers: Map<string, Peer>;
      rooms: Map<string, Set<string>>;
      roomOwners: Map<string, string>;
      roomScreenShare: Map<string, string>;
    };

  it('creates a screen producer and notifies room', async () => {
    const otherSocket = createSocket('socket-2');
    const produce = jest.fn().mockResolvedValue({
      id: 'screen-producer-1',
      kind: 'video',
      appData: { source: 'screen' },
      close: jest.fn(),
      paused: false,
    });
    const state = serviceState();

    state.peers.set(socket.id, {
      id: socket.id,
      userId: 'user-1',
      username: 'alice',
      socket,
      sendTransport: { id: 'send-1', produce } as unknown as WebRtcTransport,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    });
    state.peers.set(otherSocket.id, {
      id: otherSocket.id,
      userId: 'user-2',
      username: 'bob',
      socket: otherSocket,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    });
    state.rooms.set('room-1', new Set([socket.id, otherSocket.id]));

    await service.createProducer(socket, {
      requestId: 'req-1',
      transportId: 'send-1',
      kind: 'video',
      rtpParameters: {} as unknown as RtpParameters,
      appData: { source: 'screen' },
    });

    expect(produce).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'video',
        appData: { source: 'screen' },
      }),
    );
    expect(socket.emit).toHaveBeenCalledWith('sfu:producer-created', {
      requestId: 'req-1',
      producerId: 'screen-producer-1',
      userId: 'user-1',
      kind: 'video',
      appData: { source: 'screen' },
    });
    expect(otherSocket.emit).toHaveBeenCalledWith('sfu:screen-share-started', {
      userId: 'user-1',
    });
  });

  it('rejects a second screen share with SCREEN_SHARE_ALREADY_ACTIVE', async () => {
    const socket2 = createSocket('socket-2');
    const state = serviceState();

    state.peers.set(socket.id, {
      id: socket.id,
      userId: 'user-1',
      username: 'alice',
      socket,
      sendTransport: {
        id: 'send-1',
        produce: jest.fn(),
      } as unknown as WebRtcTransport,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    });
    state.peers.set(socket2.id, {
      id: socket2.id,
      userId: 'user-2',
      username: 'bob',
      socket: socket2,
      sendTransport: {
        id: 'send-1',
        produce: jest.fn(),
      } as unknown as WebRtcTransport,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    });
    state.rooms.set('room-1', new Set([socket.id, socket2.id]));
    state.roomScreenShare.set('room-1', socket.id);

    await service.createProducer(socket2, {
      requestId: 'req-2',
      transportId: 'send-1',
      kind: 'video',
      rtpParameters: {} as unknown as RtpParameters,
      appData: { source: 'screen' },
    });

    expect(socket2.emit).toHaveBeenCalledWith('sfu:produce-error', {
      requestId: 'req-2',
      code: 'SCREEN_SHARE_ALREADY_ACTIVE',
      message: 'Another participant is already sharing',
    });
  });

  it('closes a screen producer and emits sfu:screen-share-stopped', async () => {
    const otherSocket = createSocket('socket-2');
    const close = jest.fn();
    const state = serviceState();

    state.peers.set(socket.id, {
      id: socket.id,
      userId: 'user-1',
      username: 'alice',
      socket,
      producers: new Map([
        [
          'screen-1',
          {
            id: 'screen-1',
            kind: 'video',
            appData: { source: 'screen' },
            close,
          } as unknown as Producer,
        ],
      ]),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    });
    state.peers.set(otherSocket.id, {
      id: otherSocket.id,
      userId: 'user-2',
      username: 'bob',
      socket: otherSocket,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    });
    state.rooms.set('room-1', new Set([socket.id, otherSocket.id]));
    state.roomScreenShare.set('room-1', socket.id);

    service.closeProducer(socket.id, 'screen-1');

    expect(close).toHaveBeenCalled();
    expect(state.roomScreenShare.has('room-1')).toBe(false);
    expect(otherSocket.emit).toHaveBeenCalledWith('sfu:screen-share-stopped', {
      userId: 'user-1',
    });
  });

  it('releases screen share lock when a peer leaves', async () => {
    const otherSocket = createSocket('socket-2');
    const state = serviceState();

    state.peers.set(socket.id, {
      id: socket.id,
      userId: 'user-1',
      username: 'alice',
      socket,
      sendTransport: { close: jest.fn() } as unknown as WebRtcTransport,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    });
    state.peers.set(otherSocket.id, {
      id: otherSocket.id,
      userId: 'user-2',
      username: 'bob',
      socket: otherSocket,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    });
    state.rooms.set('room-1', new Set([socket.id, otherSocket.id]));
    state.roomScreenShare.set('room-1', socket.id);

    await service.leaveRoom(socket);

    expect(state.roomScreenShare.has('room-1')).toBe(false);
    expect(otherSocket.emit).toHaveBeenCalledWith('sfu:screen-share-stopped', {
      userId: 'user-1',
    });
  });

  it('releases screen share lock when a peer is kicked', async () => {
    const ownerSocket = createSocket('socket-owner');
    const targetSocket = {
      ...createSocket('socket-target'),
      disconnect: jest.fn(),
    } as unknown as Socket & { disconnect: jest.Mock };
    const state = serviceState();

    state.peers.set(ownerSocket.id, {
      id: ownerSocket.id,
      userId: 'user-1',
      username: 'alice',
      socket: ownerSocket,
      sendTransport: { close: jest.fn() } as unknown as WebRtcTransport,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('host'),
    });
    state.peers.set(targetSocket.id, {
      id: targetSocket.id,
      userId: 'user-2',
      username: 'bob',
      socket: targetSocket,
      sendTransport: { close: jest.fn() } as unknown as WebRtcTransport,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    });
    state.rooms.set('room-1', new Set([ownerSocket.id, targetSocket.id]));
    state.roomOwners.set('room-1', 'user-1');
    state.roomScreenShare.set('room-1', targetSocket.id);

    await service.kickPeer(ownerSocket, 'user-2');

    expect(state.roomScreenShare.has('room-1')).toBe(false);
    expect(ownerSocket.emit).toHaveBeenCalledWith('sfu:screen-share-stopped', {
      userId: 'user-2',
    });
  });

  it('includes appData.source in sfu:new-producer broadcast', async () => {
    const otherSocket = createSocket('socket-2');
    const produce = jest.fn().mockResolvedValue({
      id: 'cam-producer-1',
      kind: 'video',
      appData: { source: 'camera' },
      close: jest.fn(),
      paused: false,
    });
    const state = serviceState();

    state.peers.set(socket.id, {
      id: socket.id,
      userId: 'user-1',
      username: 'alice',
      socket,
      sendTransport: { id: 'send-1', produce } as unknown as WebRtcTransport,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    });
    state.peers.set(otherSocket.id, {
      id: otherSocket.id,
      userId: 'user-2',
      username: 'bob',
      socket: otherSocket,
      recvTransport: { id: 'recv-1' } as unknown as WebRtcTransport,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    });
    state.rooms.set('room-1', new Set([socket.id, otherSocket.id]));

    await service.createProducer(socket, {
      requestId: 'req-cam',
      transportId: 'send-1',
      kind: 'video',
      rtpParameters: {} as unknown as RtpParameters,
      appData: { source: 'camera' },
    });

    expect(otherSocket.emit).toHaveBeenCalledWith('sfu:new-producer', {
      producerId: 'cam-producer-1',
      userId: 'user-1',
      username: 'alice',
      kind: 'video',
      paused: false,
      appData: { source: 'camera' },
    });
  });
});

describe('room-token join', () => {
  const tokenClaims: RoomTokenClaims = {
    roomId: 'room-1',
    projectId: 'project-1',
    keyId: 'key-1',
    participantId: 'participant-1',
    name: 'Alice',
    role: 'participant',
  };

  function verifyResult(claims: typeof tokenClaims): RoomTokenVerifyResult {
    return { ok: true, claims };
  }

  it('joins with identity from token claims, not payload fields', async () => {
    (roomTokenHelper.verify as jest.Mock).mockReturnValue(
      verifyResult(tokenClaims),
    );
    prisma.apiKey.findUnique.mockResolvedValue({ revokedAt: null });

    await service.joinRoom(socket, {
      roomId: 'room-1',
      token: 'signed-token',
    });

    const state = service as unknown as SfuServiceState;
    const peer = state.peers.get(socket.id) as Peer;
    expect(peer.userId).toBe('participant-1');
    expect(peer.username).toBe('Alice');
    expect(peer.capabilities).toEqual([
      'send-audio',
      'send-video',
      'send-screenshare',
      'send-data-message',
    ]);
    expect(socket.emit).toHaveBeenCalledWith(
      'sfu:joined',
      expect.objectContaining({
        participant: { id: 'participant-1', username: 'Alice' },
        capabilities: [
          'send-audio',
          'send-video',
          'send-screenshare',
          'send-data-message',
        ],
      }),
    );
  });

  it('delivers no send capabilities for a viewer-role token', async () => {
    (roomTokenHelper.verify as jest.Mock).mockReturnValue(
      verifyResult({ ...tokenClaims, role: 'viewer' }),
    );
    prisma.apiKey.findUnique.mockResolvedValue({ revokedAt: null });

    await service.joinRoom(socket, {
      roomId: 'room-1',
      token: 'signed-token',
    });

    const state = service as unknown as SfuServiceState;
    const peer = state.peers.get(socket.id) as Peer;
    expect(peer.capabilities).toEqual([]);
    expect(socket.emit).toHaveBeenCalledWith(
      'sfu:joined',
      expect.objectContaining({ capabilities: [] }),
    );
  });

  it('rejects an invalid token with a coded error and no peer', async () => {
    (roomTokenHelper.verify as jest.Mock).mockReturnValue({
      ok: false,
      code: 'ROOM_TOKEN_INVALID',
    });

    await service.joinRoom(socket, {
      roomId: 'room-1',
      token: 'garbage',
    });

    expect(socket.emit).toHaveBeenCalledWith('sfu:join-error', {
      code: 'ROOM_TOKEN_INVALID',
      message: 'Room token is not valid',
    });
    const state = service as unknown as SfuServiceState;
    expect(state.peers.has(socket.id)).toBe(false);
  });

  it('rejects a token minted for another room', async () => {
    (roomTokenHelper.verify as jest.Mock).mockReturnValue(
      verifyResult({ ...tokenClaims, roomId: 'room-other' }),
    );

    await service.joinRoom(socket, {
      roomId: 'room-1',
      token: 'signed-token',
    });

    expect(socket.emit).toHaveBeenCalledWith('sfu:join-error', {
      code: 'ROOM_TOKEN_ROOM_MISMATCH',
      message: 'Room token was minted for a different room',
    });
  });

  it('rejects a token whose minting key was revoked', async () => {
    (roomTokenHelper.verify as jest.Mock).mockReturnValue(
      verifyResult(tokenClaims),
    );
    prisma.apiKey.findUnique.mockResolvedValue({
      revokedAt: new Date(),
    });

    await service.joinRoom(socket, {
      roomId: 'room-1',
      token: 'signed-token',
    });

    expect(socket.emit).toHaveBeenCalledWith('sfu:join-error', {
      code: 'ROOM_TOKEN_INVALID',
      message: 'API key is not active',
    });
  });

  it('surfaces token-carried correlation fields in peer events and webhooks', async () => {
    const metadata = { tenant: 'acme', seat: 4 };
    (roomTokenHelper.verify as jest.Mock).mockReturnValue(
      verifyResult({
        ...tokenClaims,
        externalId: 'user-42',
        metadata,
      }),
    );
    prisma.apiKey.findUnique.mockResolvedValue({ revokedAt: null });
    await service.joinRoom(socket, {
      roomId: 'room-1',
      token: 'signed-token',
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'sfu:joined',
      expect.objectContaining({
        participant: {
          id: 'participant-1',
          username: 'Alice',
          externalId: 'user-42',
          metadata,
        },
      }),
    );
    expect(webhooks.participantJoined).toHaveBeenCalledWith(
      'room-1',
      undefined,
      {
        id: 'participant-1',
        displayName: 'Alice',
        externalId: 'user-42',
        metadata,
      },
    );

    // A second token join (no correlation fields of its own) sees Alice's
    // fields through the existing-participants snapshot, and Alice sees the
    // newcomer's peer-joined event without them.
    (roomTokenHelper.verify as jest.Mock).mockReturnValue(
      verifyResult({
        ...tokenClaims,
        participantId: 'participant-2',
        name: 'Bob',
      }),
    );
    const second = createSocket('socket-2');
    await service.joinRoom(second, {
      roomId: 'room-1',
      token: 'signed-token',
    });
    // Alice is notified about Bob without correlation fields of his own...
    expect(socket.emit).toHaveBeenCalledWith('sfu:peer-joined', {
      userId: 'participant-2',
      username: 'Bob',
    });
    // ...and Bob's existing-participants snapshot carries Alice's fields.
    expect(second.emit).toHaveBeenCalledWith('sfu:existing-peers', [
      {
        userId: 'participant-1',
        username: 'Alice',
        externalId: 'user-42',
        metadata,
      },
    ]);
  });

  it('omits correlation fields entirely on non-token joins', async () => {
    await service.joinRoom(socket, { roomId: 'room-1' });

    expect(webhooks.participantJoined).toHaveBeenCalledWith(
      'room-1',
      undefined,
      {
        id: 'user-1',
        displayName: 'alice',
      },
    );
    const ack = (socket.emit as jest.Mock).mock.calls.find(
      ([event]: [string]) => event === 'sfu:joined',
    );
    expect(ack?.[1].participant).toEqual({ id: 'user-1', username: 'alice' });
  });
  it('refuses produce for a viewer-role participant per kind', async () => {
    (roomTokenHelper.verify as jest.Mock).mockReturnValue(
      verifyResult({ ...tokenClaims, role: 'viewer' }),
    );
    prisma.apiKey.findUnique.mockResolvedValue({ revokedAt: null });

    await service.joinRoom(socket, {
      roomId: 'room-1',
      token: 'signed-token',
    });

    for (const kind of ['audio', 'video'] as const) {
      (socket.emit as jest.Mock).mockClear();
      await service.createProducer(socket, {
        requestId: 'req-1',
        transportId: 'send-1',
        kind,
        rtpParameters: {} as unknown as RtpParameters,
      });

      expect(socket.emit).toHaveBeenCalledWith('sfu:produce-error', {
        requestId: 'req-1',
        code: 'PUBLISH_NOT_ALLOWED',
        message: `Missing send-${kind} capability`,
      });
    }
  });

  it('refuses screen share produce without send-screenshare', async () => {
    (roomTokenHelper.verify as jest.Mock).mockReturnValue(
      verifyResult({ ...tokenClaims, role: 'viewer' }),
    );
    prisma.apiKey.findUnique.mockResolvedValue({ revokedAt: null });

    await service.joinRoom(socket, {
      roomId: 'room-1',
      token: 'signed-token',
    });

    await service.createProducer(socket, {
      requestId: 'req-2',
      transportId: 'send-1',
      kind: 'video',
      rtpParameters: {} as unknown as RtpParameters,
      appData: { source: 'screen' },
    });

    expect(socket.emit).toHaveBeenCalledWith('sfu:produce-error', {
      requestId: 'req-2',
      code: 'PUBLISH_NOT_ALLOWED',
      message: 'Missing send-screenshare capability',
    });
  });

  it('lets a host-role token participant kick in a project room', async () => {
    (roomTokenHelper.verify as jest.Mock).mockReturnValue(
      verifyResult({ ...tokenClaims, participantId: 'admin-1', role: 'host' }),
    );
    prisma.apiKey.findUnique.mockResolvedValue({ revokedAt: null });

    const adminSocket = createSocket('socket-admin');
    await service.joinRoom(adminSocket, {
      roomId: 'room-1',
      token: 'signed-token',
    });

    const targetSocket = createSocket('socket-target');
    await service.joinRoom(targetSocket, {
      roomId: 'room-1',
    });

    // The plain join resolves to the default verified user (user-1).
    const ack = await service.kickPeer(adminSocket, 'user-1');

    expect(ack).toEqual({ ok: true });
    expect(targetSocket.emit).toHaveBeenCalledWith('sfu:kicked', {
      roomId: 'room-1',
    });
  });
});

describe('handshake-verified join', () => {
  const state = () =>
    service as unknown as {
      peers: Map<string, Peer>;
      roomOwners: Map<string, string>;
    };

  it('derives a user join from the verified JWT and DB, not the payload', async () => {
    workerManager.createRouter.mockResolvedValue({} as Router<AppData>);
    workerManager.getRtpCapabilities.mockReturnValue(
      {} as unknown as RtpCapabilities,
    );

    await service.joinRoom(socket, { roomId: 'room-1' });

    const peer = state().peers.get(socket.id) as Peer;
    expect(peer.userId).toBe('user-1');
    expect(peer.username).toBe('alice');
    expect(prisma.room.findUnique).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      select: { slug: true, ownerId: true },
    });
    expect(socket.emit).toHaveBeenCalledWith('sfu:joined', expect.anything());
  });

  it('records ownership only when the verified user owns the room', async () => {
    workerManager.createRouter.mockResolvedValue({} as Router<AppData>);
    workerManager.getRtpCapabilities.mockReturnValue(
      {} as unknown as RtpCapabilities,
    );
    jwtService.verify.mockReturnValue({ id: 'user-2' });
    prisma.user.findUnique.mockResolvedValue({ username: 'mallory' });
    prisma.room.findUnique.mockResolvedValue({
      slug: 'abc123',
      ownerId: 'user-1',
    });

    await service.joinRoom(socket, { roomId: 'room-1' });

    expect(state().roomOwners.has('room-1')).toBe(false);
  });

  it('refuses a join with no verifiable credential', async () => {
    socket.handshake.auth = {};

    await service.joinRoom(socket, { roomId: 'room-1' });

    expect(socket.emit).toHaveBeenCalledWith('sfu:join-error', {
      code: 'SFU_JOIN_UNAUTHORIZED',
      message: expect.any(String),
    });
    expect(state().peers.has(socket.id)).toBe(false);
  });

  it('refuses cookie identity from a non-allowlisted origin', async () => {
    socket.handshake.auth = {};
    socket.handshake.headers.cookie = 'access_token=good';
    socket.handshake.headers.origin = 'https://evil.example';

    await service.joinRoom(socket, { roomId: 'room-1' });

    expect(socket.emit).toHaveBeenCalledWith('sfu:join-error', {
      code: 'SFU_JOIN_UNAUTHORIZED',
      message: expect.any(String),
    });
    expect(state().peers.has(socket.id)).toBe(false);
  });

  it('joins an approved guest from the guest cookie for the matching room', async () => {
    workerManager.createRouter.mockResolvedValue({} as Router<AppData>);
    workerManager.getRtpCapabilities.mockReturnValue(
      {} as unknown as RtpCapabilities,
    );
    socket.handshake.auth = {};
    socket.handshake.headers.cookie = 'zvonok_guest_abc123=guest-jwt';
    socket.handshake.headers.origin = 'http://localhost:5173';
    config.get.mockImplementation((key: string) =>
      key === 'JWT_GUEST_SECRET'
        ? 'guest-secret'
        : key === 'CLIENT_URL'
          ? 'http://localhost:5173'
          : undefined,
    );
    jwtService.verify.mockReturnValue({
      guestId: 'guest-1',
      displayName: 'Gwen',
      roomSlug: 'abc123',
      scope: 'room',
    });

    await service.joinRoom(socket, { roomId: 'room-1' });

    const peer = state().peers.get(socket.id) as Peer;
    expect(peer.userId).toBe('guest-1');
    expect(peer.username).toBe('Gwen');
    expect(socket.emit).toHaveBeenCalledWith('sfu:joined', expect.anything());
  });

  it('refuses a guest whose token was issued for another room', async () => {
    socket.handshake.auth = {};
    socket.handshake.headers.cookie = 'zvonok_guest_abc123=guest-jwt';
    socket.handshake.headers.origin = 'http://localhost:5173';
    config.get.mockImplementation((key: string) =>
      key === 'JWT_GUEST_SECRET' ? 'guest-secret' : undefined,
    );
    jwtService.verify.mockReturnValue({
      guestId: 'guest-1',
      displayName: 'Gwen',
      roomSlug: 'abc123',
      scope: 'room',
    });
    prisma.room.findUnique.mockResolvedValue({
      slug: 'other-room',
      ownerId: null,
    });

    await service.joinRoom(socket, { roomId: 'room-1' });

    expect(socket.emit).toHaveBeenCalledWith('sfu:join-error', {
      code: 'SFU_JOIN_FORBIDDEN',
      message: expect.any(String),
    });
    expect(state().peers.has(socket.id)).toBe(false);
  });
});

describe('host controls', () => {
  const controlClaims: RoomTokenClaims = {
    roomId: 'room-1',
    projectId: 'project-1',
    keyId: 'key-1',
    participantId: 'participant-1',
    name: 'Alice',
    role: 'participant',
  };

  type ControlState = {
    peers: Map<string, Peer>;
    rooms: Map<string, Set<string>>;
    roomOwners: Map<string, string>;
    roomLocks: Map<string, boolean>;
  };

  const state = () => service as unknown as ControlState;

  const makeProducer = (id: string, kind: 'audio' | 'video') =>
    ({
      id,
      kind,
      paused: false,
      pause: jest.fn(),
      appData: { source: 'camera' },
    }) as unknown as Producer;

  function seedPeer(
    socket: Socket,
    userId: string,
    roomId: string,
    options: { ownerId?: string; role?: ParticipantRole } = {},
  ): Peer {
    const peer: Peer = {
      id: socket.id,
      userId,
      username: userId,
      socket,
      producers: new Map(),
      consumers: new Map(),
      ownsRoom: options.ownerId === userId,
      capabilities: capabilitiesForRole(
        options.ownerId === userId ? 'host' : (options.role ?? 'participant'),
      ),
    };
    state().peers.set(peer.id, peer);
    const roomPeers = state().rooms.get(roomId) ?? new Set<string>();
    roomPeers.add(peer.id);
    state().rooms.set(roomId, roomPeers);
    if (options.ownerId) {
      state().roomOwners.set(roomId, options.ownerId);
    }
    return peer;
  }

  function joinTokenPeer(
    socket: Socket,
    claims: Partial<typeof controlClaims> = {},
  ): Promise<void> {
    (roomTokenHelper.verify as jest.Mock).mockReturnValue({
      ok: true,
      claims: { ...controlClaims, ...claims },
    });
    prisma.apiKey.findUnique.mockResolvedValue({ revokedAt: null });
    return service.joinRoom(socket, {
      roomId: 'room-1',
      token: 'signed-token',
    });
  }

  it('lets the room owner mute a peer and announces it to the room', async () => {
    const ownerSocket = createSocket('socket-owner');
    seedPeer(ownerSocket, 'user-1', 'room-1', { ownerId: 'user-1' });
    const target = seedPeer(createSocket('socket-target'), 'user-2', 'room-1');
    const audio = makeProducer('prod-a', 'audio');
    const video = makeProducer('prod-v', 'video');
    target.producers.set(audio.id, audio);
    target.producers.set(video.id, video);

    await service.mutePeer(ownerSocket, 'user-2');

    expect(audio.pause).toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalled();
    expect(ownerSocket.emit).toHaveBeenCalledWith('sfu:peer-muted', {
      userId: 'user-2',
    });
    expect(target.socket.emit).toHaveBeenCalledWith('sfu:peer-muted', {
      userId: 'user-2',
    });
  });

  it('denies a plain user mute with a coded ack and no state change', async () => {
    const ownerSocket = createSocket('socket-owner');
    const owner = seedPeer(ownerSocket, 'user-1', 'room-1', {
      ownerId: 'user-1',
    });
    const audio = makeProducer('prod-a', 'audio');
    owner.producers.set(audio.id, audio);
    const plainSocket = createSocket('socket-plain');
    seedPeer(plainSocket, 'user-2', 'room-1');

    const ack = await service.mutePeer(plainSocket, 'user-1');

    expect(ack).toEqual({
      ok: false,
      code: 'MISSING_CAPABILITY',
      message: 'Missing mute-users capability',
    });
    expect(audio.pause).not.toHaveBeenCalled();
    expect(ownerSocket.emit).not.toHaveBeenCalledWith(
      'sfu:peer-muted',
      expect.anything(),
    );
  });

  it('denies a plain token participant lock in a project room', async () => {
    const ownerSocket = createSocket('socket-owner');
    seedPeer(ownerSocket, 'user-1', 'room-1', { ownerId: 'user-1' });
    const plainToken = createSocket('socket-token');
    await joinTokenPeer(plainToken, { role: 'participant' });

    const ack = await service.lockRoom(plainToken, true);

    expect(ack).toEqual({
      ok: false,
      code: 'MISSING_CAPABILITY',
      message: 'Missing lock-room capability',
    });
    expect(state().roomLocks.has('room-1')).toBe(false);
    expect(ownerSocket.emit).not.toHaveBeenCalledWith(
      'sfu:room-locked',
      expect.anything(),
    );
  });

  it('lets a host-role token participant mute and lock in a project room', async () => {
    const adminSocket = createSocket('socket-admin');
    await joinTokenPeer(adminSocket, {
      participantId: 'admin-1',
      role: 'host',
    });
    const target = seedPeer(createSocket('socket-target'), 'user-2', 'room-1');
    const audio = makeProducer('prod-a', 'audio');
    target.producers.set(audio.id, audio);

    const muteAck = await service.mutePeer(adminSocket, 'user-2');

    expect(muteAck).toEqual({ ok: true });
    expect(audio.pause).toHaveBeenCalled();
    expect(target.socket.emit).toHaveBeenCalledWith('sfu:peer-muted', {
      userId: 'user-2',
    });

    const lockAck = await service.lockRoom(adminSocket, true);

    expect(lockAck).toEqual({ ok: true });
    expect(adminSocket.emit).toHaveBeenCalledWith('sfu:room-locked', {
      locked: true,
    });
    expect(target.socket.emit).toHaveBeenCalledWith('sfu:room-locked', {
      locked: true,
    });
  });

  it('mutes every publisher except the host on mute-all', async () => {
    const host = seedPeer(createSocket('socket-host'), 'user-1', 'room-1', {
      ownerId: 'user-1',
    });
    const hostProducer = makeProducer('prod-host', 'audio');
    host.producers.set(hostProducer.id, hostProducer);

    const publisher = seedPeer(
      createSocket('socket-publisher'),
      'user-2',
      'room-1',
    );
    const pubAudio = makeProducer('prod-a2', 'audio');
    const pubVideo = makeProducer('prod-v2', 'video');
    publisher.producers.set(pubAudio.id, pubAudio);
    publisher.producers.set(pubVideo.id, pubVideo);

    const listener = seedPeer(
      createSocket('socket-listener'),
      'user-3',
      'room-1',
    );

    await service.muteAll(host.socket);

    expect(hostProducer.pause).not.toHaveBeenCalled();
    expect(pubAudio.pause).toHaveBeenCalled();
    expect(pubVideo.pause).toHaveBeenCalled();
    expect(listener.socket.emit).toHaveBeenCalledWith('sfu:peer-muted', {
      userId: 'user-2',
    });
    expect(listener.socket.emit).not.toHaveBeenCalledWith('sfu:peer-muted', {
      userId: 'user-1',
    });
    expect(listener.socket.emit).not.toHaveBeenCalledWith('sfu:peer-muted', {
      userId: 'user-3',
    });
  });

  it('locks the room and refuses every new join with ROOM_LOCKED', async () => {
    const ownerSocket = createSocket('socket-owner');
    seedPeer(ownerSocket, 'user-1', 'room-1', { ownerId: 'user-1' });

    await service.lockRoom(ownerSocket, true);

    expect(ownerSocket.emit).toHaveBeenCalledWith('sfu:room-locked', {
      locked: true,
    });

    const joiner = createSocket('socket-joiner');
    await service.joinRoom(joiner, {
      roomId: 'room-1',
    });
    expect(joiner.emit).toHaveBeenCalledWith('sfu:join-error', {
      code: 'ROOM_LOCKED',
      message: expect.any(String),
    });

    // The gate sits before token verification, so the token path is refused
    // without even looking at the token.
    const tokenJoiner = createSocket('socket-token-joiner');
    await service.joinRoom(tokenJoiner, {
      roomId: 'room-1',
      token: 'signed-token',
    });
    expect(tokenJoiner.emit).toHaveBeenCalledWith('sfu:join-error', {
      code: 'ROOM_LOCKED',
      message: expect.any(String),
    });
    expect(roomTokenHelper.verify).not.toHaveBeenCalled();
  });

  it('treats lock state idempotently and broadcasts only on change', async () => {
    const ownerSocket = createSocket('socket-owner');
    const otherSocket = createSocket('socket-other');
    seedPeer(ownerSocket, 'user-1', 'room-1', { ownerId: 'user-1' });
    seedPeer(otherSocket, 'user-2', 'room-1');

    await service.lockRoom(ownerSocket, true);
    expect(otherSocket.emit).toHaveBeenCalledWith('sfu:room-locked', {
      locked: true,
    });

    (ownerSocket.emit as jest.Mock).mockClear();
    (otherSocket.emit as jest.Mock).mockClear();

    await service.lockRoom(ownerSocket, true);
    expect(ownerSocket.emit).not.toHaveBeenCalled();
    expect(otherSocket.emit).not.toHaveBeenCalled();

    await service.lockRoom(ownerSocket, false);
    expect(otherSocket.emit).toHaveBeenCalledWith('sfu:room-locked', {
      locked: false,
    });

    (otherSocket.emit as jest.Mock).mockClear();
    await service.lockRoom(ownerSocket, false);
    expect(otherSocket.emit).not.toHaveBeenCalled();
    expect(state().roomLocks.get('room-1')).toBe(false);
  });

  it('clears the lock when the room ends so it can be joined again', async () => {
    const ownerSocket = createSocket('socket-owner');
    seedPeer(ownerSocket, 'user-1', 'room-1', { ownerId: 'user-1' });
    await service.lockRoom(ownerSocket, true);

    await service.endRoom('room-1');

    expect(state().roomLocks.has('room-1')).toBe(false);
    workerManager.createRouter.mockResolvedValue({} as Router<AppData>);
    workerManager.getRtpCapabilities.mockReturnValue(
      {} as unknown as RtpCapabilities,
    );
    const joiner = createSocket('socket-joiner');
    await service.joinRoom(joiner, {
      roomId: 'room-1',
    });
    expect(joiner.emit).toHaveBeenCalledWith('sfu:joined', expect.anything());
    expect(joiner.emit).not.toHaveBeenCalledWith(
      'sfu:join-error',
      expect.anything(),
    );
  });

  it('clears the lock when the last peer leaves the room', async () => {
    const ownerSocket = createSocket('socket-owner');
    seedPeer(ownerSocket, 'user-1', 'room-1', { ownerId: 'user-1' });
    await service.lockRoom(ownerSocket, true);
    expect(state().roomLocks.get('room-1')).toBe(true);

    await service.leaveRoom(ownerSocket);

    expect(state().roomLocks.has('room-1')).toBe(false);
  });

  it('clears a lingering lock when a room with no peers is ended', async () => {
    state().roomLocks.set('room-empty', true);

    await service.endRoom('room-empty');

    expect(state().roomLocks.has('room-empty')).toBe(false);
    expect(workerManager.closeRouter).not.toHaveBeenCalled();
  });

  describe('data channel broadcast', () => {
    it('relays a valid broadcast to the room minus the sender', () => {
      const sender = createSocket('socket-sender');
      seedPeer(sender, 'user-1', 'room-1', { ownerId: 'user-1' });
      const other = createSocket('socket-other');
      seedPeer(other, 'user-2', 'room-1');

      const ack = service.broadcast(sender, {
        topic: 'reactions',
        payload: { emoji: 'wave' },
      });

      expect(ack).toEqual({ ok: true });
      expect(other.emit).toHaveBeenCalledWith('sfu:broadcast', {
        senderId: 'user-1',
        topic: 'reactions',
        payload: { emoji: 'wave' },
        timestamp: expect.any(String),
      });
      expect(sender.emit).not.toHaveBeenCalledWith(
        'sfu:broadcast',
        expect.anything(),
      );
    });

    it('denies a viewer without the capability and relays nothing', () => {
      const sender = createSocket('socket-viewer');
      seedPeer(sender, 'v-1', 'room-1', { role: 'viewer' });
      const other = createSocket('socket-other-v');
      seedPeer(other, 'user-2', 'room-1');

      const ack = service.broadcast(sender, {
        topic: 'reactions',
        payload: 1,
      });

      expect(ack).toEqual({
        ok: false,
        code: 'MISSING_CAPABILITY',
        message: 'Missing send-data-message capability',
      });
      expect(other.emit).not.toHaveBeenCalledWith(
        'sfu:broadcast',
        expect.anything(),
      );
    });

    it('rejects an oversized serialized payload with PAYLOAD_TOO_LARGE', () => {
      const sender = createSocket('socket-sender-big');
      seedPeer(sender, 'user-1', 'room-1', { ownerId: 'user-1' });
      const other = createSocket('socket-other-big');
      seedPeer(other, 'user-2', 'room-1');

      const ack = service.broadcast(sender, {
        topic: 'blob',
        payload: { data: 'x'.repeat(8193) },
      });

      expect(ack).toEqual({
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'payload must serialize to at most 8192 bytes',
      });
      expect(other.emit).not.toHaveBeenCalledWith(
        'sfu:broadcast',
        expect.anything(),
      );
    });

    it('accepts a payload serializing to exactly the cap', () => {
      const sender = createSocket('socket-sender-edge');
      seedPeer(sender, 'user-1', 'room-1', { ownerId: 'user-1' });

      // {"data":"xxxx..."} serializes to exactly 8192 bytes.
      const filler = 'x'.repeat(8192 - '{"data":""}'.length);
      const ack = service.broadcast(sender, {
        topic: 'blob',
        payload: { data: filler },
      });

      expect(ack).toEqual({ ok: true });
    });

    it.each(['', 'has space', 'unnícíde', 'a'.repeat(65)])(
      'rejects malformed topic %j with INVALID_TOPIC',
      (topic) => {
        const sender = createSocket('socket-sender-topic');
        seedPeer(sender, 'user-1', 'room-1', { ownerId: 'user-1' });
        const other = createSocket('socket-other-topic');
        seedPeer(other, 'user-2', 'room-1');

        const ack = service.broadcast(sender, { topic, payload: 1 });

        expect(ack).toEqual({
          ok: false,
          code: 'INVALID_TOPIC',
          message: 'topic must be 1-64 characters of [A-Za-z0-9._-]',
        });
        expect(other.emit).not.toHaveBeenCalledWith(
          'sfu:broadcast',
          expect.anything(),
        );
      },
    );

    it('answers NOT_IN_ROOM for an unjoined socket', () => {
      const ack = service.broadcast(createSocket('socket-stray'), {
        topic: 'reactions',
        payload: 1,
      });

      expect(ack).toEqual({
        ok: false,
        code: 'NOT_IN_ROOM',
        message: 'Join the room before broadcasting',
      });
    });
  });
});

describe('webhook emissions', () => {
  type WebhookState = {
    peers: Map<string, Peer>;
    rooms: Map<string, Set<string>>;
    roomOwners: Map<string, string>;
  };

  const state = () => service as unknown as WebhookState;

  function seedPeer(
    sock: Socket,
    userId: string,
    roomId: string,
    options: { ownerId?: string } = {},
  ): Peer {
    const peer: Peer = {
      id: sock.id,
      userId,
      username: userId,
      socket: sock,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole(
        options.ownerId === userId ? 'host' : 'participant',
      ),
    };
    state().peers.set(peer.id, peer);
    const roomPeers = state().rooms.get(roomId) ?? new Set<string>();
    roomPeers.add(peer.id);
    state().rooms.set(roomId, roomPeers);
    if (options.ownerId) {
      state().roomOwners.set(roomId, options.ownerId);
    }
    return peer;
  }

  function joinViaUser(
    sock: Socket,
    userId: string,
    overrides: Partial<SfuJoinPayload> = {},
  ): Promise<void> {
    workerManager.createRouter.mockResolvedValue({} as Router<AppData>);
    workerManager.getRtpCapabilities.mockReturnValue(
      {} as unknown as RtpCapabilities,
    );
    jwtService.verify.mockReturnValue({ id: userId });
    prisma.user.findUnique.mockResolvedValue({ username: userId });
    prisma.room.findUnique.mockResolvedValue({
      slug: 'room-1-slug',
      ownerId: null,
    });
    return service.joinRoom(sock, {
      roomId: 'room-1',
      roomSlug: 'room-1-slug',
      ...overrides,
    });
  }

  it('emits room.started and participant.joined when the first peer joins', async () => {
    await joinViaUser(socket, 'user-1');

    expect(webhooks.roomStarted).toHaveBeenCalledWith('room-1', 'room-1-slug');
    expect(webhooks.participantJoined).toHaveBeenCalledWith(
      'room-1',
      'room-1-slug',
      { id: 'user-1', displayName: 'user-1' },
    );
  });

  it('emits only participant.joined for subsequent peers', async () => {
    const second = createSocket('socket-2');
    await joinViaUser(socket, 'user-1');
    await joinViaUser(second, 'user-2');

    expect(webhooks.roomStarted).toHaveBeenCalledTimes(1);
    expect(webhooks.participantJoined).toHaveBeenCalledTimes(2);
    expect(webhooks.participantJoined).toHaveBeenLastCalledWith(
      'room-1',
      'room-1-slug',
      { id: 'user-2', displayName: 'user-2' },
    );
  });

  it('emits participant.joined with the token identity for token joins', async () => {
    (roomTokenHelper.verify as jest.Mock).mockReturnValue({
      ok: true,
      claims: {
        roomId: 'room-1',
        projectId: 'project-1',
        keyId: 'key-1',
        participantId: 'participant-1',
        name: 'Alice',
        role: 'participant',
      },
    });
    prisma.apiKey.findUnique.mockResolvedValue({ revokedAt: null });

    await joinViaUser(socket, 'ignored', { token: 'signed-token' });

    expect(webhooks.participantJoined).toHaveBeenCalledWith(
      'room-1',
      'room-1-slug',
      { id: 'participant-1', displayName: 'Alice' },
    );
  });

  it('emits participant.left with reason leave on an explicit leave', async () => {
    seedPeer(socket, 'user-1', 'room-1');

    await service.leaveRoom(socket);

    expect(webhooks.participantLeft).toHaveBeenCalledWith(
      'room-1',
      undefined,
      { id: 'user-1', displayName: 'user-1' },
      'leave',
    );
  });

  it('emits participant.left with reason kick on a host kick', async () => {
    const ownerSocket = createSocket('socket-owner');
    seedPeer(ownerSocket, 'user-1', 'room-1', { ownerId: 'user-1' });
    seedPeer(createSocket('socket-target'), 'user-2', 'room-1');

    await service.kickPeer(ownerSocket, 'user-2');

    expect(webhooks.participantLeft).toHaveBeenCalledWith(
      'room-1',
      undefined,
      { id: 'user-2', displayName: 'user-2' },
      'kick',
    );
  });

  it('emits participant.left with reason disconnect on grace expiry', async () => {
    seedPeer(socket, 'user-1', 'room-1');
    const previousGrace = presence.rejoinGraceMs;
    presence.rejoinGraceMs = 10;

    await service.closePeer(socket);
    expect(webhooks.participantLeft).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(webhooks.participantLeft).toHaveBeenCalledWith(
      'room-1',
      undefined,
      { id: 'user-1', displayName: 'user-1' },
      'disconnect',
    );
    presence.rejoinGraceMs = previousGrace;
  });

  it('emits participant.left(room-end) for every peer, then room.ended', async () => {
    seedPeer(socket, 'user-1', 'room-1');
    const second = createSocket('socket-2');
    seedPeer(second, 'user-2', 'room-1');

    await service.endRoom('room-1');

    expect(webhooks.participantLeft).toHaveBeenCalledTimes(2);
    expect(webhooks.participantLeft).toHaveBeenCalledWith(
      'room-1',
      undefined,
      { id: 'user-1', displayName: 'user-1' },
      'room-end',
    );
    expect(webhooks.participantLeft).toHaveBeenLastCalledWith(
      'room-1',
      undefined,
      { id: 'user-2', displayName: 'user-2' },
      'room-end',
    );

    const lastLeftCall =
      webhooks.participantLeft.mock.invocationCallOrder.slice(-1)[0];
    const endedCall = webhooks.roomEnded.mock.invocationCallOrder[0];
    expect(endedCall).toBeGreaterThan(lastLeftCall);
    expect(webhooks.roomEnded).toHaveBeenCalledWith('room-1', undefined);
  });

  it('emits room.ended even when the room has no SFU peers', async () => {
    await service.endRoom('room-empty');

    expect(webhooks.roomEnded).toHaveBeenCalledWith('room-empty', undefined);
    expect(workerManager.closeRouter).not.toHaveBeenCalled();
  });
});

describe('rejoin grace', () => {
  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  function seed(
    sock: Socket,
    userId: string,
    roomId: string,
    options: { ownerId?: string } = {},
  ): Peer {
    const peer: Peer = {
      id: sock.id,
      userId,
      username: userId,
      socket: sock,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole(
        options.ownerId === userId ? 'host' : 'participant',
      ),
    };
    const state = service as unknown as {
      peers: Map<string, Peer>;
      rooms: Map<string, Set<string>>;
      roomOwners: Map<string, string>;
    };
    state.peers.set(peer.id, peer);
    const roomPeers = state.rooms.get(roomId) ?? new Set<string>();
    roomPeers.add(peer.id);
    state.rooms.set(roomId, roomPeers);
    if (options.ownerId) {
      state.roomOwners.set(roomId, options.ownerId);
    }
    return peer;
  }

  function joinViaUser(
    sock: Socket,
    userId: string,
    overrides: Partial<SfuJoinPayload> = {},
  ): Promise<void> {
    workerManager.createRouter.mockResolvedValue({} as Router<AppData>);
    workerManager.getRtpCapabilities.mockReturnValue(
      {} as unknown as RtpCapabilities,
    );
    jwtService.verify.mockReturnValue({ id: userId });
    prisma.user.findUnique.mockResolvedValue({ username: userId });
    prisma.room.findUnique.mockResolvedValue({
      slug: 'room-1-slug',
      ownerId: null,
    });
    return service.joinRoom(sock, {
      roomId: 'room-1',
      roomSlug: 'room-1-slug',
      ...overrides,
    });
  }

  beforeEach(() => {
    presence.rejoinGraceMs = 10;
  });

  afterEach(() => {
    presence.rejoinGraceMs = 30_000;
  });

  it('restores a same-id rejoin silently: no events, no webhooks', async () => {
    const alice = createSocket('socket-alice');
    const bob = createSocket('socket-bob');
    await joinViaUser(alice, 'user-1');
    await joinViaUser(bob, 'user-2');
    webhooks.participantJoined.mockClear();
    webhooks.roomStarted.mockClear();
    (alice.emit as jest.Mock).mockClear();

    await service.closePeer(bob);
    await joinViaUser(createSocket('socket-bob-2'), 'user-2');

    expect(webhooks.participantJoined).not.toHaveBeenCalled();
    expect(webhooks.roomStarted).not.toHaveBeenCalled();
    const aliceEvents = (alice.emit as jest.Mock).mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(aliceEvents).not.toContain('sfu:peer-left');
    expect(aliceEvents).not.toContain('sfu:peer-joined');
  });

  it('answers the rejoin with the normal acknowledgement and peers', async () => {
    const alice = createSocket('socket-alice');
    const bob = createSocket('socket-bob');
    await joinViaUser(alice, 'user-1');
    await joinViaUser(bob, 'user-2');

    await service.closePeer(bob);
    const restored = createSocket('socket-bob-2');
    await joinViaUser(restored, 'user-2');

    const restoredEvents = (restored.emit as jest.Mock).mock.calls.filter(
      (call: unknown[]) => call[0] === 'sfu:existing-peers',
    );
    expect(restoredEvents.length).toBe(1);
    expect((restored.emit as jest.Mock).mock.calls).toContainEqual([
      'sfu:joined',
      expect.objectContaining({
        participant: expect.objectContaining({ id: 'user-2' }),
      }),
    ]);
  });

  it('runs the leave flow with reason disconnect on expiry', async () => {
    const alice = createSocket('socket-alice');
    const bob = createSocket('socket-bob');
    await joinViaUser(alice, 'user-1');
    await joinViaUser(bob, 'user-2');
    webhooks.participantJoined.mockClear();

    await service.closePeer(bob);
    await wait(40);

    expect(webhooks.participantLeft).toHaveBeenCalledWith(
      'room-1',
      'room-1-slug',
      { id: 'user-2', displayName: 'user-2' },
      'disconnect',
    );
    expect(alice.emit).toHaveBeenCalledWith('sfu:peer-left', {
      userId: 'user-2',
    });
  });

  it('announces sfu:peer-media-detached when a peer seat is held', async () => {
    const alice = createSocket('socket-alice');
    const bob = createSocket('socket-bob');
    await joinViaUser(alice, 'user-1');
    await joinViaUser(bob, 'user-2');

    await service.closePeer(bob);

    expect(alice.emit).toHaveBeenCalledWith('sfu:peer-media-detached', {
      userId: 'user-2',
    });
  });

  it('announces sfu:peer-media-detached before the departure event', async () => {
    const alice = createSocket('socket-alice');
    const bob = createSocket('socket-bob');
    await joinViaUser(alice, 'user-1');
    await joinViaUser(bob, 'user-2');
    presence.rejoinGraceMs = 10;

    await service.closePeer(bob);
    await wait(40);
    presence.rejoinGraceMs = 30_000;

    const events = (alice.emit as jest.Mock).mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(events.indexOf('sfu:peer-media-detached')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('sfu:peer-media-detached')).toBeLessThan(
      events.indexOf('sfu:peer-left'),
    );
  });

  it('does not repeat the detach announcement on a silent same-id rejoin', async () => {
    const alice = createSocket('socket-alice');
    const bob = createSocket('socket-bob');
    await joinViaUser(alice, 'user-1');
    await joinViaUser(bob, 'user-2');
    (alice.emit as jest.Mock).mockClear();

    await service.closePeer(bob);
    const restored = createSocket('socket-bob-2');
    await joinViaUser(restored, 'user-2');

    // The initial blip announces the detach exactly once; the restore runs
    // through the normal new-producer flow with no departure events.
    const detachEvents = (alice.emit as jest.Mock).mock.calls.filter(
      (call: unknown[]) => call[0] === 'sfu:peer-media-detached',
    );
    expect(detachEvents).toHaveLength(1);
    expect(detachEvents[0]).toEqual(['sfu:peer-media-detached', { userId: 'user-2' }]);
    expect((alice.emit as jest.Mock).mock.calls).not.toContainEqual([
      'sfu:peer-left',
      { userId: 'user-2' },
    ]);
  });

  it('refuses a kicked peer rejoin for the room lifetime', async () => {
    const owner = createSocket('socket-owner');
    const target = createSocket('socket-target');
    seed(owner, 'user-1', 'room-1', { ownerId: 'user-1' });
    seed(target, 'user-2', 'room-1');

    await service.kickPeer(owner, 'user-2');
    const rejoiner = createSocket('socket-target-2');
    await joinViaUser(rejoiner, 'user-2');

    expect(rejoiner.emit).toHaveBeenCalledWith('sfu:join-error', {
      code: 'KICKED_FROM_ROOM',
      message: 'Removed from the room by the host',
    });
    const state = service as unknown as { peers: Map<string, Peer> };
    expect(
      Array.from(state.peers.values()).some((peer) => peer.userId === 'user-2'),
    ).toBe(false);
  });

  it('clears kick terminality when the room empties', async () => {
    const owner = createSocket('socket-owner');
    const target = createSocket('socket-target');
    seed(owner, 'user-1', 'room-1', { ownerId: 'user-1' });
    seed(target, 'user-2', 'room-1');

    await service.kickPeer(owner, 'user-2');
    await service.leaveRoom(owner);
    workerManager.closeRouter.mockResolvedValue(undefined);

    const rejoiner = createSocket('socket-kicked-2');
    await joinViaUser(rejoiner, 'user-2');

    expect(rejoiner.emit).not.toHaveBeenCalledWith(
      'sfu:join-error',
      expect.anything(),
    );
    expect(webhooks.participantJoined).toHaveBeenCalledWith(
      'room-1',
      'room-1-slug',
      expect.objectContaining({ id: 'user-2' }),
    );
  });

  it('keeps an explicit leave immediate with a fresh join afterwards', async () => {
    const alice = createSocket('socket-alice');
    const bob = createSocket('socket-bob');
    await joinViaUser(alice, 'user-1');
    await joinViaUser(bob, 'user-2');
    webhooks.participantJoined.mockClear();

    await service.leaveRoom(bob);

    expect(webhooks.participantLeft).toHaveBeenCalledWith(
      'room-1',
      'room-1-slug',
      { id: 'user-2', displayName: 'user-2' },
      'leave',
    );
    await joinViaUser(createSocket('socket-bob-2'), 'user-2');
    expect(webhooks.participantJoined).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a peer whose room ended during grace', async () => {
    const bob = createSocket('socket-bob');
    seed(bob, 'user-2', 'room-1');

    await service.closePeer(bob);
    workerManager.closeRouter.mockResolvedValue(undefined);
    await service.endRoom('room-1');
    webhooks.participantLeft.mockClear();

    await wait(40);

    expect(webhooks.participantLeft).not.toHaveBeenCalled();
  });
});

describe('egress taps', () => {
  const serviceState = () =>
    service as unknown as {
      peers: Map<string, Peer>;
      rooms: Map<string, Set<string>>;
    };

  const addPeerWithProducers = (
    socketId: string,
    producers: Array<{
      id: string;
      kind: 'audio' | 'video';
      appData?: Record<string, unknown>;
    }>,
  ) => {
    serviceState().peers.set(socketId, {
      id: socketId,
      userId: `user-${socketId}`,
      username: socketId,
      socket: createSocket(socketId),
      producers: new Map(
        producers.map((producer) => [
          producer.id,
          {
            id: producer.id,
            kind: producer.kind,
            paused: false,
            appData: producer.appData ?? {},
          },
        ]),
      ),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    } as unknown as Peer);
  };

  it('lists room taps across peers with sources, defaulting audio to camera', () => {
    addPeerWithProducers('socket-1', [
      { id: 'producer-video', kind: 'video', appData: { source: 'camera' } },
      { id: 'producer-screen', kind: 'video', appData: { source: 'screen' } },
    ]);
    addPeerWithProducers('socket-2', [
      { id: 'producer-audio', kind: 'audio', appData: {} },
    ]);
    serviceState().rooms.set('room-1', new Set(['socket-1', 'socket-2']));

    expect(service.listTaps('room-1')).toEqual([
      { producerId: 'producer-video', kind: 'video', source: 'camera' },
      { producerId: 'producer-screen', kind: 'video', source: 'screen' },
      { producerId: 'producer-audio', kind: 'audio', source: 'camera' },
    ]);
  });

  it('lists no taps for an unknown room', () => {
    expect(service.listTaps('room-404')).toEqual([]);
  });

  it('opens a tap with the shared plain transport options and target', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const closeTransport = jest.fn();
    const createPlainTransport = jest.fn().mockResolvedValue({
      connect,
      close: closeTransport,
      consume: jest.fn().mockResolvedValue({
        rtpParameters: {},
        on: jest.fn(),
        off: jest.fn(),
        close: jest.fn(),
      }),
    });
    workerManager.getRouter.mockImplementation(
      () => ({ createPlainTransport }) as unknown as Router<AppData>,
    );

    await service.openTap('room-1', 'producer-video', {
      ip: '127.0.0.1',
      port: 42000,
    });

    expect(createPlainTransport).toHaveBeenCalledTimes(1);
    expect(createPlainTransport.mock.calls[0][0]).toEqual({
      listenIp: mediasoupConfig.webRtcTransport.listenIps[0],
      rtcpMux: true,
      comedia: false,
    });
    expect(connect).toHaveBeenCalledWith({ ip: '127.0.0.1', port: 42000 });
  });

  it('rejects tap creation for an unknown room', async () => {
    workerManager.getRouter.mockReturnValue(
      undefined as unknown as Router<AppData>,
    );

    await expect(
      service.openTap('room-404', 'producer-video', {
        ip: '127.0.0.1',
        port: 42000,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('opens an unpaused consumer, wires producer-close, and closes both on close', async () => {
    const routerRtpCapabilities = { codecs: [] } as unknown as RtpCapabilities;
    const rtpParameters = { mid: '0' } as unknown as RtpParameters;
    const consumerCbs = new Map<string, Set<() => void>>();
    const fire = (event: string) => {
      for (const cb of [...(consumerCbs.get(event) ?? [])]) cb();
    };
    const consumer = {
      id: 'consumer-1',
      rtpParameters,
      on: jest.fn((event: string, cb: () => void) => {
        let set = consumerCbs.get(event);
        if (!set) {
          set = new Set();
          consumerCbs.set(event, set);
        }
        set.add(cb);
      }),
      off: jest.fn((event: string, cb: () => void) => {
        consumerCbs.get(event)?.delete(cb);
      }),
      close: jest.fn(),
    };
    const consume = jest.fn().mockResolvedValue(consumer);
    const closeTransport = jest.fn();
    const transport = {
      connect: jest.fn().mockResolvedValue(undefined),
      consume,
      close: closeTransport,
    } as unknown as PlainTransport;
    workerManager.getRouter.mockReturnValue({
      rtpCapabilities: routerRtpCapabilities,
      createPlainTransport: jest.fn().mockResolvedValue(transport),
    } as unknown as Router<AppData>);

    const handle = await service.openTap('room-1', 'producer-video', {
      ip: '127.0.0.1',
      port: 42000,
    });

    expect(consume).toHaveBeenCalledWith({
      producerId: 'producer-video',
      rtpCapabilities: routerRtpCapabilities,
      paused: false,
      appData: { tap: true },
    });
    expect(consume.mock.calls[0][0].rtpCapabilities).toBe(
      routerRtpCapabilities,
    );
    expect(handle.rtpParameters).toBe(rtpParameters);

    const producerClosed = jest.fn();
    const unsubscribe = handle.onProducerClosed(producerClosed);
    fire('producerclose');
    expect(producerClosed).toHaveBeenCalledTimes(1);
    unsubscribe();
    fire('producerclose');
    expect(producerClosed).toHaveBeenCalledTimes(1);

    handle.close();
    expect(consumer.close).toHaveBeenCalledTimes(1);
    expect(closeTransport).toHaveBeenCalledTimes(1);
  });

  it('closes the transport when consuming the producer fails', async () => {
    const consume = jest.fn().mockRejectedValue(new Error('no producer'));
    const closeTransport = jest.fn();
    const transport = {
      connect: jest.fn().mockResolvedValue(undefined),
      consume,
      close: closeTransport,
    } as unknown as PlainTransport;
    workerManager.getRouter.mockReturnValue({
      rtpCapabilities: { codecs: [] },
      createPlainTransport: jest.fn().mockResolvedValue(transport),
    } as unknown as Router<AppData>);

    await expect(
      service.openTap('room-1', 'producer-video', {
        ip: '127.0.0.1',
        port: 42000,
      }),
    ).rejects.toThrow('no producer');
    expect(closeTransport).toHaveBeenCalledTimes(1);
  });

  it('notifies tap handlers per room and honors unsubscribe', async () => {
    const produce = jest.fn().mockResolvedValue({
      id: 'producer-live',
      kind: 'video',
      paused: false,
      appData: { source: 'camera' },
    });
    const state = serviceState();
    state.peers.set(socket.id, {
      id: socket.id,
      userId: 'user-1',
      username: 'alice',
      socket,
      sendTransport: { id: 'send-1', produce } as unknown as WebRtcTransport,
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    } as unknown as Peer);
    state.rooms.set('room-1', new Set([socket.id]));
    state.rooms.set('room-2', new Set(['socket-other']));

    const room1Events: RoomTapDescriptor[] = [];
    const room2Events: RoomTapDescriptor[] = [];
    const unsubscribe = service.onProducerAdded('room-1', (descriptor) =>
      room1Events.push(descriptor),
    );
    service.onProducerAdded('room-2', (descriptor) =>
      room2Events.push(descriptor),
    );

    await service.createProducer(socket, {
      requestId: 'req-1',
      transportId: 'send-1',
      kind: 'video',
      rtpParameters: {} as unknown as RtpParameters,
      appData: { source: 'camera' },
    });

    expect(room1Events).toEqual([
      { producerId: 'producer-live', kind: 'video', source: 'camera' },
    ]);
    expect(room2Events).toEqual([]);

    unsubscribe();
    await service.createProducer(socket, {
      requestId: 'req-2',
      transportId: 'send-1',
      kind: 'video',
      rtpParameters: {} as unknown as RtpParameters,
      appData: { source: 'camera' },
    });

    expect(room1Events).toHaveLength(1);
  });

  const addBarePeer = (socketId: string) => {
    serviceState().peers.set(socketId, {
      id: socketId,
      userId: `user-${socketId}`,
      username: socketId,
      socket: createSocket(socketId),
      producers: new Map(),
      consumers: new Map(),
      capabilities: capabilitiesForRole('participant'),
    } as unknown as Peer);
  };

  it('fires room-closed handlers once when a populated room is ended', async () => {
    addBarePeer('socket-1');
    serviceState().rooms.set('room-1', new Set(['socket-1']));
    const closed = jest.fn();
    presence.onRoomClosed('room-1', closed);

    await service.endRoom('room-1');

    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed.mock.invocationCallOrder[0]).toBeLessThan(
      workerManager.closeRouter.mock.invocationCallOrder[0],
    );
  });

  it('fires room-closed handlers when the last peer leaves the room', async () => {
    addBarePeer('socket-1');
    serviceState().rooms.set('room-1', new Set(['socket-1']));
    const closed = jest.fn();
    presence.onRoomClosed('room-1', closed);
    const previousGrace = presence.rejoinGraceMs;
    presence.rejoinGraceMs = 10;

    await service.closePeer(createSocket('socket-1'));
    expect(closed).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed.mock.invocationCallOrder[0]).toBeLessThan(
      workerManager.closeRouter.mock.invocationCallOrder[0],
    );
    presence.rejoinGraceMs = previousGrace;
  });

  it('honors room-closed unsubscribe and fires only for the closed room', async () => {
    const room1Closed = jest.fn();
    const room2Closed = jest.fn();
    const unsubscribe = presence.onRoomClosed('room-1', room1Closed);
    presence.onRoomClosed('room-2', room2Closed);
    unsubscribe();

    await service.endRoom('room-1');
    await service.endRoom('room-2');

    expect(room1Closed).not.toHaveBeenCalled();
    expect(room2Closed).toHaveBeenCalledTimes(1);
  });
});
