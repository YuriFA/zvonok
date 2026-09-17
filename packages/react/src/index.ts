/**
 * @zvonok/react public entry point: headless React bindings over
 * {@link https://www.npmjs.com/package/@zvonok/client | @zvonok/client}
 * plus the embedded room entry (./embedded).
 */

export { ZvonokProvider, type ZvonokProviderProps } from "./contexts/zvonok-context.js";
export { useZvonokSession, type ZvonokSession } from "./contexts/zvonok-context.js";
export {
  useZvonokConnection,
  type UseZvonokConnectionOptions,
  type UseZvonokConnectionResult,
} from "./hooks/use-zvonok-connection.js";
export {
  useParticipants,
  type UseParticipantsResult,
} from "./hooks/use-participants.js";
export { useViewportQuality } from "./core/use-viewport-quality.js";
export {
  PeerQualityProvider,
  usePeerQualityContext,
  usePeerQualityStats,
  type PeerQualityProviderProps,
} from "./contexts/peer-quality-context.js";
export {
  PeerQualityEngine,
  STATS_INTERVAL_MS,
  LAYER_SWITCH_DEBOUNCE_MS,
  type PeerQualityBindOptions,
} from "./core/peer-quality-engine.js";
export {
  usePublishControls,
  type UsePublishControlsResult,
  type UsePublishControlsOptions,
  type PublishToggleResult,
  type PublishKind,
} from "./hooks/use-publish-controls.js";
export {
  useZvonokCall,
  type UseZvonokCallOptions,
  type UseZvonokCallResult,
  type ToggleControl,
} from "./hooks/use-zvonok-call.js";
export {
  createMediaCapturePort,
  type CapturePort,
  type MediaCapturePortOptions,
} from "./hooks/capture-port.js";
export { useSfuTrackSync } from "./core/use-sfu-track-sync.js";
export {
  usePrejoin,
  type UsePrejoinOptions,
  type UsePrejoinResult,
  type PrejoinPhase,
} from "./hooks/use-prejoin.js";
export {
  hasCapabilities,
  CapabilitiesGate,
  type CapabilitiesGateProps,
  type RequiredCapabilities,
} from "./wrappers/capability-gate.js";
export {
  deriveMediaControlState,
  type MediaControlState,
  type DeriveMediaControlStateOptions,
} from "./hooks/derive-media-control.js";
export {
  mapScreenShareError,
  type ScreenShareErrorPresentation,
} from "./hooks/map-screen-share-error.js";
export {
  useRoomLayout,
  type RoomLayout,
  type RoomLayoutParticipant,
  type ArrangedTile,
  type RoomLayoutSpotlight,
  type LayoutRect,
  type UseRoomLayoutOptions,
} from "./hooks/use-room-layout.js";
export {
  Tile,
  useTileContext,
  resolveUiProp,
  type TileProps,
  type TileContextValue,
} from "./core/tile.js";
export { useVideoStream } from "./core/use-video-stream.js";
export {
  useDevicePermissions,
  type DevicePermissionState,
} from "./hooks/use-device-permissions.js";
export {
  useActiveSpeaker,
  useAudioLevels,
  type AudioActivitySnapshot,
} from "./hooks/use-audio-activity.js";
export {
  useRemoteAudio,
  type UseRemoteAudioOptions,
  type UseRemoteAudioResult,
} from "./hooks/use-remote-audio.js";
export {
  useScreenShare,
  type UseScreenShareResult,
} from "./hooks/use-screen-share.js";
export {
  useGuestJoinRequests,
  type GuestJoinRequest,
  type UseGuestJoinRequestsResult,
} from "./hooks/use-guest-join-requests.js";
export {
  useHostControls,
  type UseHostControlsResult,
} from "./hooks/use-host-controls.js";
export { createHostControls, type HostControls } from "./hooks/host-controls.js";
export { useOwnCapabilities } from "./hooks/use-own-capabilities.js";
export {
  useEgressState,
  type UseEgressStateResult,
} from "./hooks/use-egress-state.js";
export {
  useEgressControls,
  type UseEgressControlsResult,
} from "./hooks/use-egress-controls.js";
export {
  useBroadcast,
  useBroadcasts,
  type UseBroadcastResult,
  type UseBroadcastsResult,
} from "./hooks/use-broadcast.js";
export {
  EMPTY_ROOM_STATE,
  RoomTracker,
  type RoomTrackerState,
} from "./hooks/room-tracker.js";
export {
  useStoreSelector,
  type ExternalStore,
} from "./hooks/use-store-selector.js";
export {
  useDeviceControls,
  loadDeviceSelection,
  type UseDeviceControlsResult,
  type UseDeviceControlsOptions,
  type ZvonokCaptureControl,
  type DeviceSelection,
} from "./hooks/use-device-controls.js";
export {
  useQualityControls,
  type UseQualityControlsResult,
  type ParticipantQualityLevel,
} from "./hooks/use-quality-controls.js";
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

// Composition blocks (one folder per block: behavior core + preset variant).
export {
  useMediaControls,
  MediaControlButton,
  MediaControlsPreset,
  type MediaControls,
  type UseMediaControlsOptions,
  type MediaControlButtonProps,
  type MediaControlsPresetProps,
} from "./components/media-controls/media-controls.js";
export {
  useParticipantsPanel,
  type PanelParticipant,
  type PanelNotice,
  type PanelNoticeKey,
  type ParticipantsPanel,
  type UseParticipantsPanelOptions,
} from "./components/participants-panel/participants-panel.js";
export {
  ParticipantsPanelPreset,
  type ParticipantsPanelPresetProps,
} from "./components/participants-panel/participants-panel-preset.js";
export {
  useDeviceSwitcher,
  type DeviceSwitcher,
  type UseDeviceSwitcherOptions,
} from "./components/device-switcher/device-switcher.js";
export {
  DeviceSwitcherPreset,
  type DeviceSwitcherPresetProps,
} from "./components/device-switcher/device-switcher-preset.js";
export {
  useRoomStatus,
  StatusCardsPreset,
  type RoomStatus,
  type UseRoomStatusOptions,
  type StatusCardsPresetProps,
} from "./components/status-cards/status-cards.js";
export {
  useStage,
  useStageSize,
  StagePreset,
  type Stage,
  type StageTile,
  type UseStageOptions,
  type StagePresetProps,
} from "./components/stage/stage.js";
export {
  ControlBarPreset,
  type ControlBarPresetProps,
} from "./components/control-bar/control-bar.js";
