import { describe, expect, it } from "vitest";

import * as entry from "../index.js";

describe("block exports", () => {
  it("exposes the block cores and presets from the package entry", () => {
    expect(Object.keys(entry)).toEqual(
      expect.arrayContaining([
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
        "useStage",
        "useStageSize",
      ]),
    );
  });
});
