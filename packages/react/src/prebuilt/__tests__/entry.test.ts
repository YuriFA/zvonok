import { describe, expect, it } from "vitest";

import * as prebuilt from "../index.js";

describe("prebuilt entry", () => {
  it("exposes the block cores and presets", () => {
    expect(Object.keys(prebuilt).sort()).toEqual(
      [
        "ControlBarPreset",
        "DeviceSwitcherPreset",
        "MediaControlButton",
        "MediaControlsPreset",
        "ParticipantsPanelPreset",
        "StagePreset",
        "StatusCardsPreset",
        "useDeviceSwitcher",
        "useMediaControls",
        "useParticipantsPanel",
        "useRoomStatus",
        "useStage",
        "useStageSize",
      ].sort(),
    );
  });
});
