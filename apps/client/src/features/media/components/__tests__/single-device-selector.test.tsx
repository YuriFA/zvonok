import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { SingleDeviceSelector } from "../single-device-selector";

function device(deviceId: string, label: string, kind: MediaDeviceKind): MediaDeviceInfo {
  return { deviceId, label, kind, groupId: "", toJSON: () => ({}) } as MediaDeviceInfo;
}

describe("SingleDeviceSelector", () => {
  it("renders a static display when there is 0 or 1 device", () => {
    const onDeviceChange = vi.fn();

    const { rerender } = render(
      <SingleDeviceSelector
        type="videoinput"
        devices={[]}
        selectedDeviceId={null}
        onDeviceChange={onDeviceChange}
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("No device available")).toBeInTheDocument();

    rerender(
      <SingleDeviceSelector
        type="videoinput"
        devices={[device("cam-1", "FaceTime HD Camera", "videoinput")]}
        selectedDeviceId={"cam-1"}
        onDeviceChange={onDeviceChange}
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("FaceTime HD Camera")).toBeInTheDocument();
  });

  it("renders a select and fires callback when multiple devices exist", () => {
    const onDeviceChange = vi.fn();

    render(
      <SingleDeviceSelector
        type="audioinput"
        devices={[
          device("mic-1", "Built-in Mic", "audioinput"),
          device("mic-2", "USB Mic", "audioinput"),
        ]}
        selectedDeviceId={"mic-1"}
        onDeviceChange={onDeviceChange}
      />,
    );

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "mic-2" } });

    expect(onDeviceChange).toHaveBeenCalledWith("mic-2");
  });

  it("disables select when disabled prop is true", () => {
    const onDeviceChange = vi.fn();

    render(
      <SingleDeviceSelector
        type="audiooutput"
        devices={[
          device("spk-1", "Built-in Speakers", "audiooutput"),
          device("spk-2", "Headphones", "audiooutput"),
        ]}
        selectedDeviceId={"spk-1"}
        onDeviceChange={onDeviceChange}
        disabled={true}
      />,
    );

    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
