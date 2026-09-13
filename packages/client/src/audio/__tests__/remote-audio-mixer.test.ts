import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IRemoteAudioMixer } from "../remote-audio-mixer";

const mockTrack = (id: string) =>
  ({ id, kind: "audio", stop: vi.fn() }) as unknown as MediaStreamTrack;

class MockMediaStream {
  private tracks: MediaStreamTrack[];
  constructor(tracks?: MediaStreamTrack[]) {
    this.tracks = tracks ?? [];
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}

function makeMockAudioElement() {
  return {
    autoplay: false,
    style: { display: "" },
    srcObject: null as unknown,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    remove: vi.fn(),
  };
}

function createMockAudioContext() {
  const gainNode = { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1.0 } };
  const analyserNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    fftSize: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 128,
  };
  const sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
  const analysisSourceNode = { connect: vi.fn(), disconnect: vi.fn() };

  const ctx = {
    resume: vi.fn(),
    close: vi.fn(),
    createMediaElementSource: vi.fn(() => sourceNode),
    createMediaStreamSource: vi.fn(() => analysisSourceNode),
    createGain: vi.fn(() => gainNode),
    createAnalyser: vi.fn(() => analyserNode),
    destination: {},
    state: "running",
    _sourceNode: sourceNode,
    _analysisSourceNode: analysisSourceNode,
    _gainNode: gainNode,
    _analyserNode: analyserNode,
  };

  return ctx;
}

let mockCtx: ReturnType<typeof createMockAudioContext>;
let audioElementsCreated: ReturnType<typeof makeMockAudioElement>[];

const originalCreateElement = document.createElement.bind(document);

vi.stubGlobal("MediaStream", MockMediaStream);

class StubAudioContext {
  resume = mockCtx.resume;
  close = mockCtx.close;
  createMediaElementSource = mockCtx.createMediaElementSource;
  createMediaStreamSource = mockCtx.createMediaStreamSource;
  createGain = mockCtx.createGain;
  createAnalyser = mockCtx.createAnalyser;
  destination = mockCtx.destination;
  state = "running";
}

vi.stubGlobal("AudioContext", StubAudioContext);

vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
  if (tag === "audio") {
    const el = makeMockAudioElement();
    audioElementsCreated.push(el);
    return el as unknown as HTMLAudioElement;
  }
  return originalCreateElement(tag);
});

describe("RemoteAudioMixer", () => {
  let mixer: IRemoteAudioMixer;

  beforeEach(async () => {
    mockCtx = createMockAudioContext();
    audioElementsCreated = [];

    // Re-stub with fresh mockCtx so StubAudioContext methods point to new mock
    vi.stubGlobal(
      "AudioContext",
      class {
        resume = mockCtx.resume;
        close = mockCtx.close;
        createMediaElementSource = mockCtx.createMediaElementSource;
        createMediaStreamSource = mockCtx.createMediaStreamSource;
        createGain = mockCtx.createGain;
        createAnalyser = mockCtx.createAnalyser;
        destination = mockCtx.destination;
        state = "running";
      },
    );

    const { RemoteAudioMixer } = await import("../remote-audio-mixer");
    mixer = new RemoteAudioMixer();
  });

  afterEach(() => {
    mixer.destroy();
  });

  it("creates AudioContext on construction", () => {
    expect(mockCtx.createMediaElementSource).not.toHaveBeenCalled();
  });

  describe("addPeer", () => {
    it("creates a hidden audio element and source → gain → analyser chain", () => {
      const track = mockTrack("t1");
      mixer.addPeer("user-1", track);

      expect(audioElementsCreated).toHaveLength(1);
      const audioEl = audioElementsCreated[0];
      expect(audioEl.autoplay).toBe(true);
      expect(audioEl.play).toHaveBeenCalled();

      expect(mockCtx.createMediaElementSource).toHaveBeenCalled();
      expect(mockCtx.createGain).toHaveBeenCalled();
      expect(mockCtx.createAnalyser).toHaveBeenCalled();

      expect(mockCtx._sourceNode.connect).toHaveBeenCalledWith(mockCtx._gainNode);
      expect(mockCtx._gainNode.connect).toHaveBeenCalledWith(mockCtx.destination);
      expect(mockCtx._analysisSourceNode.connect).toHaveBeenCalledWith(mockCtx._analyserNode);
    });

    it("replaces existing peer if added again", () => {
      mixer.addPeer("user-1", mockTrack("t1"));
      mixer.addPeer("user-1", mockTrack("t2"));
      expect(mockCtx.createMediaElementSource).toHaveBeenCalledTimes(2);
      expect(audioElementsCreated).toHaveLength(2);
    });
  });

  describe("removePeer", () => {
    it("disconnects nodes, pauses and removes audio element", () => {
      mixer.addPeer("user-1", mockTrack("t1"));
      const audioEl = audioElementsCreated[0];
      mixer.removePeer("user-1");

      expect(mockCtx._sourceNode.disconnect).toHaveBeenCalled();
      expect(audioEl.pause).toHaveBeenCalled();
      expect(audioEl.remove).toHaveBeenCalled();
    });

    it("is a no-op for unknown peer", () => {
      expect(() => mixer.removePeer("unknown")).not.toThrow();
    });
  });

  describe("updatePeerTrack", () => {
    it("delegates to addPeer for a full rebuild", () => {
      const track1 = mockTrack("t1");
      const track2 = mockTrack("t2");
      mixer.addPeer("user-1", track1);
      mixer.updatePeerTrack("user-1", track2);

      // addPeer is called twice (initial + rebuild), each creates a new audio element
      expect(mockCtx.createMediaElementSource).toHaveBeenCalledTimes(2);
      expect(audioElementsCreated).toHaveLength(2);
    });

    it("delegates to addPeer if peer not found", () => {
      mixer.updatePeerTrack("unknown", mockTrack("t1"));
      expect(mockCtx.createMediaElementSource).toHaveBeenCalled();
    });
  });

  describe("setSink", () => {
    it("returns false if setSinkId not supported", async () => {
      const result = await mixer.setSink("device-1");
      expect(result).toBe(false);
    });
  });

  describe("setGain", () => {
    it("sets gain value for peer", () => {
      mixer.addPeer("user-1", mockTrack("t1"));
      mixer.setGain("user-1", 0.5);
      expect(mockCtx._gainNode.gain.value).toBe(0.5);
    });

    it("clamps gain to 0..1", () => {
      mixer.addPeer("user-1", mockTrack("t1"));
      mixer.setGain("user-1", 2);
      expect(mockCtx._gainNode.gain.value).toBe(1);
    });

    it("is a no-op for unknown peer", () => {
      expect(() => mixer.setGain("unknown", 0.5)).not.toThrow();
    });
  });

  describe("getAnalyser", () => {
    it("returns analyser for known peer", () => {
      mixer.addPeer("user-1", mockTrack("t1"));
      const analyser = mixer.getAnalyser("user-1");
      expect(analyser).toBe(mockCtx._analyserNode);
    });

    it("returns undefined for unknown peer", () => {
      expect(mixer.getAnalyser("unknown")).toBeUndefined();
    });
  });

  describe("destroy", () => {
    it("closes AudioContext and removes all peer audio elements", () => {
      mixer.addPeer("user-1", mockTrack("t1"));
      mixer.addPeer("user-2", mockTrack("t2"));
      const els = [...audioElementsCreated];
      mixer.destroy();

      expect(mockCtx.close).toHaveBeenCalled();
      for (const el of els) {
        expect(el.remove).toHaveBeenCalled();
      }
    });
  });

  it("adds an idempotent analysis tap and removes it on demand", () => {
    const track = mockTrack("mic-1");

    const first = mixer.addAnalysisTap("me-1", track);
    const second = mixer.addAnalysisTap("me-1", track);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(mockCtx.createMediaStreamSource).toHaveBeenCalledTimes(1);

    mixer.removeAnalysisTap("me-1");
    expect(mockCtx._analysisSourceNode.disconnect).toHaveBeenCalled();
  });

  it("rebuilds the tap when the analysed track changes", () => {
    mixer.addAnalysisTap("me-1", mockTrack("mic-1"));
    mixer.addAnalysisTap("me-1", mockTrack("mic-2"));

    expect(mockCtx.createMediaStreamSource).toHaveBeenCalledTimes(2);
  });

  it("closes the shared context on destroy after taps were used", () => {
    mixer.addAnalysisTap("me-1", mockTrack("mic-1"));
    expect(mockCtx.close).not.toHaveBeenCalled();

    mixer.destroy();

    expect(mockCtx.close).toHaveBeenCalledTimes(1);
  });
});
