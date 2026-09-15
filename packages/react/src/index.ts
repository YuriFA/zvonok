/**
 * @zvonok/react public entry point: headless React bindings over
 * {@link https://www.npmjs.com/package/@zvonok/client | @zvonok/client}
 * plus the embedded room entry (./embedded).
 */

export { ZvonokProvider, type ZvonokProviderProps } from "./zvonok-context.js";
export { useZvonokSession, type ZvonokSession } from "./zvonok-context.js";
export {
  useZvonokConnection,
  type UseZvonokConnectionOptions,
  type UseZvonokConnectionResult,
} from "./use-zvonok-connection.js";
export {
  useParticipants,
  type UseParticipantsResult,
} from "./use-participants.js";
export { useViewportQuality } from "./use-viewport-quality.js";
export {
  PeerQualityProvider,
  usePeerQualityContext,
  usePeerQualityStats,
  type PeerQualityProviderProps,
} from "./peer-quality-context.js";
export {
  PeerQualityEngine,
  STATS_INTERVAL_MS,
  LAYER_SWITCH_DEBOUNCE_MS,
  type PeerQualityBindOptions,
} from "./peer-quality-engine.js";
export {
  usePublishControls,
  type UsePublishControlsResult,
  type UsePublishControlsOptions,
  type PublishToggleHooks,
  type PublishToggleResult,
  type PublishKind,
} from "./use-publish-controls.js";
export { useSfuTrackSync } from "./use-sfu-track-sync.js";
export {
  usePrejoin,
  type UsePrejoinOptions,
  type UsePrejoinResult,
  type PrejoinPhase,
} from "./use-prejoin.js";
export {
  hasCapabilities,
  CapabilitiesGate,
  type CapabilitiesGateProps,
  type RequiredCapabilities,
} from "./capability-gate.js";
export {
  deriveMediaControlState,
  type MediaControlState,
  type DeriveMediaControlStateOptions,
} from "./derive-media-control.js";
export {
  mapScreenShareError,
  type ScreenShareErrorPresentation,
} from "./map-screen-share-error.js";
export {
  useRoomLayout,
  type RoomLayout,
  type RoomLayoutParticipant,
  type ArrangedTile,
  type RoomLayoutSpotlight,
  type LayoutRect,
  type UseRoomLayoutOptions,
} from "./use-room-layout.js";
export {
  Tile,
  useTileContext,
  resolveUiProp,
  type TileProps,
  type TileContextValue,
} from "./tile.js";
export { useVideoStream } from "./use-video-stream.js";
export {
  useDevicePermissions,
  type DevicePermissionState,
} from "./use-device-permissions.js";
export {
  useActiveSpeaker,
  useAudioLevels,
  type AudioActivitySnapshot,
} from "./use-audio-activity.js";
export {
  useRemoteAudio,
  type UseRemoteAudioOptions,
  type UseRemoteAudioResult,
} from "./use-remote-audio.js";
export {
  useScreenShare,
  type UseScreenShareResult,
} from "./use-screen-share.js";
export {
  useGuestJoinRequests,
  type GuestJoinRequest,
  type UseGuestJoinRequestsResult,
} from "./use-guest-join-requests.js";
export {
  useHostControls,
  type UseHostControlsResult,
} from "./use-host-controls.js";
export { createHostControls, type HostControls } from "./host-controls.js";
export { useOwnCapabilities } from "./use-own-capabilities.js";
export {
  useEgressState,
  type UseEgressStateResult,
} from "./use-egress-state.js";
export {
  useEgressControls,
  type UseEgressControlsResult,
} from "./use-egress-controls.js";
export {
  useBroadcast,
  useBroadcasts,
  type UseBroadcastResult,
  type UseBroadcastsResult,
} from "./use-broadcast.js";
export {
  EMPTY_ROOM_STATE,
  RoomTracker,
  type RoomTrackerState,
} from "./room-tracker.js";
export {
  useStoreSelector,
  type ExternalStore,
} from "./use-store-selector.js";
export {
  useDeviceControls,
  loadDeviceSelection,
  type UseDeviceControlsResult,
  type UseDeviceControlsOptions,
  type ZvonokCaptureControl,
  type DeviceSelection,
} from "./use-device-controls.js";
export {
  useQualityControls,
  type UseQualityControlsResult,
  type ParticipantQualityLevel,
} from "./use-quality-controls.js";
export {
  ZvonokError,
  ZvonokHostError,
  ZvonokJoinError,
  ZvonokEgressError,
  ZvonokBroadcastError,
  type ZvonokEgressLocalErrorCode,
  type ZvonokHostLocalErrorCode,
  type ZvonokServerEgressErrorCode,
  type ZvonokServerHostErrorCode,
  type ZvonokServerJoinErrorCode,
} from "./errors.js";
export type { ZvonokParticipant, ZvonokStatus } from "./types.js";
