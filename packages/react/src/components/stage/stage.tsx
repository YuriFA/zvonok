/**
 * Stage block: resolves the room arrangement (grid or spotlight) into
 * markup-free tile descriptors, plus the preset stage that renders them.
 * The core owns the active-screen-share selection and per-tile geometry;
 * consumers render tiles with whatever markup they like.
 */

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  PeerQualityProvider,
  Tile,
  useRoomLayout,
  type UseScreenShareResult,
  type UseZvonokCallResult,
} from "../../index.js";

export interface StageTile {
  key: string;
  /**
   * Participant id for camera tiles: opts the tile into viewport-driven
   * layer selection. Screen-share and local tiles stay unwired.
   */
  userId?: string;
  name: string;
  stream: MediaStream | null;
  isVideoOn: boolean;
  isAudioOn: boolean;
  isLocal: boolean;
  isScreen: boolean;
  style?: React.CSSProperties;
}

export interface UseStageOptions {
  call: UseZvonokCallResult;
  screenShare: UseScreenShareResult;
  /** Stage size; zero width keeps the flow grid (no spotlight derivation). */
  width: number;
  height: number;
  /** Local tile name (default "You"). */
  localName?: string;
}

export interface Stage {
  tiles: StageTile[];
  /** The screen-share spotlight tile, or null when nobody shares. */
  spotlight: StageTile | null;
}

function rectStyle(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): React.CSSProperties | undefined {
  // A zero rect means the derivation ran without a stage size (flow grid);
  // consumers lay such tiles out themselves.
  if (rect.width === 0 && rect.height === 0) {
    return undefined;
  }
  return {
    position: "absolute",
    top: 0,
    left: 0,
    width: rect.width,
    height: rect.height,
    transform: `translateX(${rect.x}px) translateY(${rect.y}px)`,
  };
}

export function useStage(options: UseStageOptions): Stage {
  const { call, screenShare, width, height, localName = "You" } = options;

  const arrangement = useMemo(
    () => [
      {
        userId: call.localUserId,
        isLocal: true,
        isScreenSharing: screenShare.sharing && screenShare.screenStream !== null,
      },
      ...call.participants
        .filter((participant) => participant.userId !== call.localUserId)
        .map((participant) => ({
          userId: participant.userId,
          isScreenSharing: participant.isScreenSharing && participant.screenStream !== null,
        })),
    ],
    [call.localUserId, call.participants, screenShare.sharing, screenShare.screenStream],
  );

  const layout = useRoomLayout({
    participants: arrangement,
    containerWidth: width,
    containerHeight: height,
  });

  const byUserId = useMemo(() => {
    const map = new Map<string, (typeof call.participants)[number]>();
    for (const participant of call.participants) {
      map.set(participant.userId, participant);
    }
    return map;
  }, [call.participants]);

  // Stable per-tile style objects: tiles keep their references across
  // unrelated room events, so memoized tile components bail out.
  const styles = useMemo(() => layout.tiles.map((tile) => rectStyle(tile.rect)), [layout.tiles]);

  const spotlightUserId = layout.spotlight === null ? null : layout.spotlight.userId;

  const tiles = useMemo<StageTile[]>(
    () =>
      layout.tiles.map((tile, index) => {
        if (tile.userId === call.localUserId) {
          return {
            key: "local",
            name: localName,
            stream: call.localVideoStream,
            isVideoOn: call.camera.isEnabled,
            isAudioOn: call.microphone.isEnabled,
            isLocal: true,
            isScreen: false,
            style: styles[index],
          };
        }
        const participant = byUserId.get(tile.userId);
        return {
          key: tile.userId,
          userId: tile.userId,
          name: participant?.displayName ?? tile.userId,
          stream: participant?.cameraStream ?? null,
          isVideoOn: participant?.isCameraEnabled ?? false,
          isAudioOn: participant?.isAudioEnabled ?? false,
          isLocal: false,
          isScreen: false,
          style: styles[index],
        };
      }),
    [
      layout.tiles,
      styles,
      byUserId,
      call.localUserId,
      call.localVideoStream,
      call.camera.isEnabled,
      call.microphone.isEnabled,
      localName,
    ],
  );

  // The active sharer's screen, placed by the derivation's spotlight rect.
  const spotlight = useMemo<StageTile | null>(() => {
    if (spotlightUserId === null || layout.spotlight === null) {
      return null;
    }
    const style = rectStyle(layout.spotlight.rect);
    if (spotlightUserId === call.localUserId) {
      if (!screenShare.screenStream) {
        return null;
      }
      return {
        key: "local-screen",
        name: localName,
        stream: screenShare.screenStream,
        isVideoOn: true,
        isAudioOn: true,
        isLocal: true,
        isScreen: true,
        style,
      };
    }
    const participant = byUserId.get(spotlightUserId);
    if (!participant?.screenStream) {
      return null;
    }
    return {
      key: `${spotlightUserId}-screen`,
      name: `${participant.displayName}'s screen`,
      stream: participant.screenStream,
      isVideoOn: true,
      isAudioOn: true,
      isLocal: false,
      isScreen: true,
      style,
    };
  }, [
    spotlightUserId,
    layout.spotlight,
    byUserId,
    call.localUserId,
    screenShare.screenStream,
    localName,
  ]);

  // Flow-grid extras: without a spotlight derivation, each remote sharer
  // gets a dedicated screen tile.
  const gridScreenTiles = useMemo<StageTile[]>(() => {
    if (spotlightUserId !== null) {
      return [];
    }
    return call.participants
      .filter(
        (participant) =>
          participant.userId !== call.localUserId &&
          participant.isScreenSharing &&
          participant.screenStream !== null,
      )
      .map((participant) => ({
        key: `${participant.userId}-screen`,
        name: `${participant.displayName}'s screen`,
        stream: participant.screenStream,
        isVideoOn: true,
        isAudioOn: true,
        isLocal: false,
        isScreen: true,
      }));
  }, [spotlightUserId, call.participants, call.localUserId]);

  return { tiles: [...tiles, ...gridScreenTiles], spotlight };
}

/** Measures the stage for the spotlight layout derivation. */
export function useStageSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

interface PresetTileProps {
  tile: StageTile;
}

/**
 * One preset tile: media plumbing in the core Tile (video binding,
 * camera-off overlay, visibility tracking), plus the preset badges.
 * Memoized so unrelated room events do not re-render every tile.
 */
const PresetTile = memo(function PresetTile({ tile }: PresetTileProps) {
  return (
    <Tile
      userId={tile.userId ?? null}
      stream={tile.stream}
      isVideoEnabled={tile.isVideoOn}
      isMuted={tile.isLocal}
      className={tile.isScreen ? "zk-tile zk-tile-screen" : "zk-tile"}
      style={tile.style}
    >
      {!tile.isAudioOn && <span className="zk-badge zk-badge-muted">muted</span>}
      <span className="zk-badge">
        {tile.name}
        {tile.isLocal ? " (you)" : ""}
      </span>
    </Tile>
  );
});

export interface StagePresetProps {
  call: UseZvonokCallResult;
  screenShare: UseScreenShareResult;
  /** False keeps the flow grid; true derives the spotlight arrangement. */
  spotlightLayout?: boolean;
  localName?: string;
  className?: string;
}

/** Preset stage: sized container with preset tiles and quality adaptation. */
export function StagePreset({
  call,
  screenShare,
  spotlightLayout = true,
  localName,
  className,
}: StagePresetProps) {
  const stage = useStageSize();
  const composed = useStage({
    call,
    screenShare,
    width: spotlightLayout ? stage.size.width : 0,
    height: spotlightLayout ? stage.size.height : 0,
    localName,
  });

  if (spotlightLayout) {
    return (
      <PeerQualityProvider enabled={call.connectionState === "connected"}>
        <div ref={stage.ref} className={["zk-stage", className].filter(Boolean).join(" ")}>
          {composed.spotlight && (
            <PresetTile key={composed.spotlight.key} tile={composed.spotlight} />
          )}
          {composed.tiles.map((tile) => (
            <PresetTile key={tile.key} tile={tile} />
          ))}
        </div>
      </PeerQualityProvider>
    );
  }

  return (
    <PeerQualityProvider enabled={call.connectionState === "connected"}>
      <div className={["zk-grid", className].filter(Boolean).join(" ")}>
        {composed.tiles.map((tile) => (
          <PresetTile key={tile.key} tile={tile} />
        ))}
      </div>
    </PeerQualityProvider>
  );
}
