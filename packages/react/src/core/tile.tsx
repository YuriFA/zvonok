/**
 * Core participant tile: owns the media plumbing that must never be
 * overridden - the <video> element binding and the viewport-visibility
 * tracking that feeds the quality engine (the "core components are
 * non-overridable" rule from the reference architecture). Everything
 * visual sits in replaceable seams: `OverlayUI` swaps the camera-off
 * overlay, `children` render badges above the media, `videoClassName`
 * styles the element.
 *
 * Requires a PeerQualityProvider ancestor (visibility tracking is the
 * adaptation engine's input). The tile renders its <video> element
 * always - a null stream clears the decoder - and covers it with the
 * overlay while the camera is off, so enable/disable never remounts the
 * element.
 */

import {
  createContext,
  createElement,
  isValidElement,
  useContext,
  useMemo,
  useRef,
  type ComponentType,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import { useVideoStream } from "./use-video-stream.js";
import { useViewportQuality } from "./use-viewport-quality.js";

export interface TileContextValue {
  userId: string | null;
  stream: MediaStream | null;
  isVideoEnabled: boolean;
}

const TileContext = createContext<TileContextValue | null>(null);

/**
 * Data hook for custom tile visuals: read the tile state this component
 * renders instead of threading props through the `*UI` swap.
 */
export function useTileContext(): TileContextValue {
  const ctx = useContext(TileContext);
  if (!ctx) {
    throw new Error("useTileContext must be used within a Tile");
  }
  return ctx;
}

/**
 * `*UI` prop resolution: undefined renders the default visual, null
 * renders nothing, a ComponentType or ReactElement replaces the default.
 */
export function resolveUiProp(
  ui: ComponentType | ReactElement | null | undefined,
  Default: ComponentType,
): ReactNode {
  if (ui === undefined) {
    return createElement(Default);
  }
  if (ui === null) {
    return null;
  }
  return isValidElement(ui) ? ui : createElement(ui);
}

/** Headless camera-off fallback: the user's initial on a dark cover. */
function DefaultTileOverlay() {
  const { userId } = useTileContext();
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#12161f",
        color: "#e5e7eb",
        fontSize: 32,
        fontWeight: 600,
        userSelect: "none",
      }}
    >
      {(userId ?? "?").charAt(0).toUpperCase()}
    </div>
  );
}

export interface TileProps {
  /** Participant this tile renders; null tiles skip visibility tracking. */
  userId: string | null;
  /** Camera stream to bind; null clears the element. */
  stream: MediaStream | null;
  /** Camera-off state: covers the video with the overlay. Default true. */
  isVideoEnabled?: boolean;
  /** Mutes the tile's own <video>; consumers routing audio elsewhere set true. */
  isMuted?: boolean;
  /** Classes for the <video> element (object-fit, mirroring). */
  videoClassName?: string;
  /** Replaces the camera-off overlay (ComponentType | ReactElement | null). */
  OverlayUI?: ComponentType | ReactElement | null;
  className?: string;
  style?: CSSProperties;
  /** Rendered above the media (badges, name labels). */
  children?: ReactNode;
}

export function Tile({
  userId,
  stream,
  isVideoEnabled = true,
  isMuted = false,
  videoClassName,
  OverlayUI,
  className,
  style,
  children,
}: TileProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useVideoStream(videoRef, stream);
  useViewportQuality(rootRef, userId);

  const contextValue = useMemo<TileContextValue>(
    () => ({ userId, stream, isVideoEnabled }),
    [userId, stream, isVideoEnabled],
  );

  return (
    <TileContext.Provider value={contextValue}>
      <div ref={rootRef} className={className} style={{ position: "relative", ...style }}>
        <video ref={videoRef} autoPlay playsInline muted={isMuted} className={videoClassName} />
        {!isVideoEnabled && resolveUiProp(OverlayUI, DefaultTileOverlay)}
        {children}
      </div>
    </TileContext.Provider>
  );
}
