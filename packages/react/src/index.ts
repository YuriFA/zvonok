/**
 * @zvonok/react public entry point: headless React bindings over
 * {@link https://www.npmjs.com/package/@zvonok/client | @zvonok/client}
 * plus the prebuilt {@link ZvonokRoom} drop-in component.
 */

export { ZvonokProvider, type ZvonokProviderProps } from "./zvonok-context.js";
export {
  useZvonokConnection,
  type UseZvonokConnectionOptions,
  type UseZvonokConnectionResult,
} from "./use-zvonok-connection.js";
export {
  useParticipants,
  type UseParticipantsResult,
} from "./use-participants.js";
export {
  useActiveSpeaker,
  useAudioLevels,
  type AudioActivitySnapshot,
} from "./use-audio-activity.js";
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
  useDeviceControls,
  type UseDeviceControlsResult,
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
export { ZvonokRoom, type ZvonokRoomProps } from "./prebuilt/ZvonokRoom.js";
