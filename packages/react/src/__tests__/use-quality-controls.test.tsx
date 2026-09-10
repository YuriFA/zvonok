import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { SfuManager } from "@zvonok/client/sfu/manager";

import { ZvonokError } from "../errors.js";
import { useQualityControls } from "../use-quality-controls.js";
import { ZvonokProvider, useZvonokSession, type ZvonokSession } from "../zvonok-context.js";
import { createMockSfuManager, type MockSfuManager } from "./doubles.js";

function Provider({ children }: { children: ReactNode }) {
  return <ZvonokProvider serverUrl="https://sfu.test">{children}</ZvonokProvider>;
}

interface QualityHookResult {
  controls: ReturnType<typeof useQualityControls>;
  session: ZvonokSession;
}

function renderQualityControls() {
  return renderHook(
    () => ({ controls: useQualityControls(), session: useZvonokSession() }),
    { wrapper: Provider },
  );
}

async function attachManager(
  result: { current: QualityHookResult },
  sfu: MockSfuManager,
) {
  await act(async () => {
    result.current.session.update({
      manager: sfu.manager as unknown as SfuManager,
      status: "joined",
    });
  });
}

describe("useQualityControls", () => {
  let sfu: MockSfuManager;

  beforeEach(() => {
    sfu = createMockSfuManager();
  });

  it("applies the simulcast preference for the mapped level", async () => {
    const { result } = renderQualityControls();
    await attachManager(result, sfu);
    sfu.manager.getVideoConsumerIdForUserId.mockReturnValue("consumer-1");

    await act(async () => {
      await result.current.controls.setParticipantQuality("user-2", "low");
    });

    expect(sfu.manager.setPreferredLayers).toHaveBeenCalledWith("consumer-1", 0);

    await act(async () => {
      await result.current.controls.setParticipantQuality("user-2", "high");
    });

    expect(sfu.manager.setPreferredLayers).toHaveBeenLastCalledWith("consumer-1", 2);
  });

  it("rejects with a typed error for a participant without subscribed video", async () => {
    const { result } = renderQualityControls();
    await attachManager(result, sfu);
    sfu.manager.getVideoConsumerIdForUserId.mockReturnValue(undefined);

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.controls.setParticipantQuality("user-unknown", "medium");
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ZvonokError);
    expect((caught as ZvonokError).code).toBe("PARTICIPANT_VIDEO_NOT_FOUND");
    expect(sfu.manager.setPreferredLayers).not.toHaveBeenCalled();
  });

  it("rejects with a typed error before a session exists", async () => {
    const { result } = renderQualityControls();

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.controls.setParticipantQuality("user-2", "low");
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(ZvonokError);
    expect((caught as ZvonokError).code).toBe("DISCONNECTED");
  });
});
