/**
 * Dev-only visual harness: renders the production room UI against a fake
 * SFU connection so Playwright can screenshot deterministic room states
 * without a backend. Scenes are selected via ?scene=; peer events are
 * emitted after the room tree mounts, so the tracker sees every one.
 *
 * Mounted at /dev/visual in development builds only.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ZvonokProvider } from "@zvonok/react";
import { useEffect, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { AuthProvider } from "@/features/auth/contexts/auth.context";
import { CaptureLifecycle } from "@/features/media/components/capture-lifecycle";
import { PrejoinView } from "@/features/room/components/prejoin-view";
import { RoomView } from "@/features/room/components/room-view";
import { GuestRequestsProvider } from "@/features/room/contexts/guest-requests.context";
import { RoomIdentityProvider } from "@/features/room/contexts/room-identity.context";
import type { Room } from "@/features/room/types/room.types";

import {
  createFakeConnection,
  createFakeSfuManager,
  staticScreenShareTrack,
  type FakePeer,
  type FakeSfuManager,
} from "./fake-sfu";

const SCENES = ["prejoin", "grid-1", "grid-2", "grid-4", "grid-6", "spotlight", "alert-kicked"];

export type VisualScene = (typeof SCENES)[number];

interface RoomSceneOptions {
  peers: FakePeer[];
  wasKicked?: boolean;
}

function sceneOptions(scene: string): RoomSceneOptions {
  if (scene.startsWith("grid-")) {
    const tiles = Number(scene.slice("grid-".length));
    const count = Number.isFinite(tiles) ? Math.max(tiles - 1, 0) : 1;
    const peers = Array.from({ length: count }, (_, i) => ({
      userId: `peer-${i + 1}`,
      username: `Peer ${i + 1}`,
    }));
    return { peers };
  }
  if (scene === "spotlight") {
    return {
      peers: [
        { userId: "peer-1", username: "Peer 1", screenShare: true },
        { userId: "peer-2", username: "Peer 2" },
      ],
    };
  }
  if (scene === "alert-kicked") {
    return { peers: [], wasKicked: true };
  }
  return { peers: [] };
}

/**
 * Drives peer events once the room tree (and its tracker) is mounted.
 * Camera and audio start paused: tiles show avatar overlays with mic
 * badges - no media content to destabilize the screenshot.
 */
function PeerDriver({ manager, options }: { manager: FakeSfuManager; options: RoomSceneOptions }) {
  useEffect(() => {
    for (const peer of options.peers) {
      manager.emitJoined({ userId: peer.userId, username: peer.username });
      manager.emitProducerState({ userId: peer.userId, kind: "video", paused: true });
      manager.emitProducerState({ userId: peer.userId, kind: "audio", paused: true });
      if (peer.screenShare) {
        manager.emitTrack(staticScreenShareTrack("SCREEN"), "video", peer.userId, "screen");
      }
    }
  }, [manager, options]);
  return null;
}
const fakeRoom = {
  id: "visual-room",
  slug: "visual-room",
  name: "Visual Room",
  ownerId: "local-user",
} as unknown as Room;

function RoomScene({ scene }: { scene: string }) {
  const manager = useMemo(() => createFakeSfuManager(), []);
  const options = useMemo(() => sceneOptions(scene), [scene]);
  const connection = useMemo(
    () => createFakeConnection(manager, { wasKicked: options.wasKicked }),
    [manager, options.wasKicked],
  );
  return (
    <div data-testid="visual-root" className="contents">
      <RoomView room={fakeRoom} connection={connection} />
      <PeerDriver manager={manager} options={options} />
    </div>
  );
}

function PrejoinScene() {
  return (
    <div data-testid="visual-root" className="contents">
      <CaptureLifecycle>
        <PrejoinView
          roomUrl="http://localhost:5173/room/visual-room"
          displayName=""
          onDisplayNameChange={() => {}}
          onJoin={() => {}}
        />
      </CaptureLifecycle>
    </div>
  );
}

export function VisualHarness() {
  const [params] = useSearchParams();
  const scene = params.get("scene") ?? "grid-2";
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
    [],
  );

  const content: ReactNode =
    scene === "prejoin" ? (
      <PrejoinScene />
    ) : (
      <CaptureLifecycle>
        <GuestRequestsProvider roomSlug="visual-room">
          <RoomScene scene={scene} />
        </GuestRequestsProvider>
      </CaptureLifecycle>
    );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ZvonokProvider serverUrl="http://localhost:3000">
          <RoomIdentityProvider userId="local-user" displayName="You">
            {content}
          </RoomIdentityProvider>
        </ZvonokProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
