/**
 * Room stage arrangement: orders participants local-first, picks the
 * spotlight sharer (local priority, then first remote), and derives tile
 * rects from @zvonok/video-layout geometry. Pure derivation - no markup,
 * no CSS; consumers position tiles themselves.
 */

import { computeLayout } from "@zvonok/video-layout";
import { useRef } from "react";

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoomLayoutParticipant {
  userId: string;
  isLocal?: boolean;
  /** Wants the spotlight: is sharing a screen with a live stream. */
  isScreenSharing?: boolean;
}

export interface ArrangedTile {
  userId: string;
  rect: LayoutRect;
}

export interface RoomLayoutSpotlight {
  userId: string;
  rect: LayoutRect;
}

export interface RoomLayout {
  mode: "grid" | "spotlight";
  spotlight: RoomLayoutSpotlight | null;
  /** One tile per participant, local first, in arrangement order. */
  tiles: ArrangedTile[];
}

export interface UseRoomLayoutOptions {
  participants: RoomLayoutParticipant[];
  containerWidth: number;
  containerHeight: number;
}

interface Arrangement {
  ordered: RoomLayoutParticipant[];
  spotlightUserId: string | null;
}

function deriveArrangement(participants: RoomLayoutParticipant[]): Arrangement {
  const local = participants.find((participant) => participant.isLocal);
  const remotes = participants.filter(
    (participant) => !participant.isLocal && participant.userId !== local?.userId,
  );
  const ordered = local ? [local, ...remotes] : [...remotes];
  return {
    ordered,
    spotlightUserId: ordered.find((participant) => participant.isScreenSharing)?.userId ?? null,
  };
}

function rectOf(area: { x: number; y: number; width: number; height: number }): LayoutRect {
  return { x: area.x, y: area.y, width: area.width, height: area.height };
}

function deriveRoomLayout(
  participants: RoomLayoutParticipant[],
  containerWidth: number,
  containerHeight: number,
): RoomLayout {
  const { ordered, spotlightUserId } = deriveArrangement(participants);
  const isSpotlight = spotlightUserId !== null;
  const grid = computeLayout({
    containerWidth,
    containerHeight,
    participantCount: ordered.length,
    spotlight: isSpotlight,
  });
  return {
    mode: isSpotlight ? "spotlight" : "grid",
    spotlight:
      spotlightUserId === null || !grid.spotlightArea
        ? null
        : { userId: spotlightUserId, rect: rectOf(grid.spotlightArea) },
    tiles: ordered.map((participant, index) => ({
      userId: participant.userId,
      rect: grid.tiles[index]
        ? rectOf(grid.tiles[index])
        : { x: 0, y: 0, width: 0, height: 0 },
    })),
  };
}

function arrangementSignature(
  participants: RoomLayoutParticipant[],
  containerWidth: number,
  containerHeight: number,
): string {
  return (
    `${containerWidth}x${containerHeight}|` +
    participants
      .map((participant) => {
        const flags = `${participant.isLocal ? 1 : 0}${participant.isScreenSharing ? 1 : 0}`;
        return `${participant.userId}:${flags}`;
      })
      .join(",")
  );
}

export function useRoomLayout(options: UseRoomLayoutOptions): RoomLayout {
  const { participants, containerWidth, containerHeight } = options;

  // Memoize on the arrangement-relevant semantics, not array identity:
  // unrelated participant churn (audio flags, stream swaps) must keep the
  // previous layout reference so memoized tile consumers bail out.
  const signature = arrangementSignature(participants, containerWidth, containerHeight);
  const layoutRef = useRef<RoomLayout | null>(null);
  const signatureRef = useRef("");

  if (layoutRef.current === null || signatureRef.current !== signature) {
    layoutRef.current = deriveRoomLayout(participants, containerWidth, containerHeight);
    signatureRef.current = signature;
  }
  return layoutRef.current;
}
