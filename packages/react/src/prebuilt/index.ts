/**
 * @zvonok/react/prebuilt: room composition blocks. Behavior cores are
 * markup-free (the vendor app renders its own UI from them); preset
 * components are the zero-wiring zk-styled variants used by the prebuilt
 * room. Preset styling ships through the package's CSS subpath exports.
 */

export { useMediaControls, MediaControlButton, MediaControlsPreset } from "./media-controls.js";
export type {
  MediaControls,
  UseMediaControlsOptions,
  MediaControlButtonProps,
  MediaControlsPresetProps,
} from "./media-controls.js";

export { useParticipantsPanel } from "./participants-panel.js";
export type {
  PanelParticipant,
  PanelNotice,
  PanelNoticeKey,
  ParticipantsPanel,
  UseParticipantsPanelOptions,
} from "./participants-panel.js";
export { ParticipantsPanelPreset } from "./participants-panel-preset.js";
export type { ParticipantsPanelPresetProps } from "./participants-panel-preset.js";

export { useDeviceSwitcher } from "./device-switcher.js";
export type { DeviceSwitcher, UseDeviceSwitcherOptions } from "./device-switcher.js";
export { DeviceSwitcherPreset } from "./device-switcher-preset.js";
export type { DeviceSwitcherPresetProps } from "./device-switcher-preset.js";

export { useRoomStatus, StatusCardsPreset } from "./status-cards.js";
export type {
  RoomStatus,
  UseRoomStatusOptions,
  StatusCardsPresetProps,
} from "./status-cards.js";

export { useStage, useStageSize, StagePreset } from "./stage.js";
export type {
  Stage,
  StageTile,
  UseStageOptions,
  StagePresetProps,
} from "./stage.js";

export { ControlBarPreset } from "./control-bar.js";
export type { ControlBarPresetProps } from "./control-bar.js";
