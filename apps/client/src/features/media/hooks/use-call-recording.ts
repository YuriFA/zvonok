import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RemotePeerMedia } from "@/features/room/hooks/use-room-sfu";

import { CallAudioMixer } from "../lib/call-audio-mixer";
import { CallRecordingCompositor, type RecordingSource } from "../lib/call-recording-compositor";
import { useMediaRecorder } from "./use-media-recorder";

export interface UseCallRecordingOptions {
  roomSlug: string;
  localUserId: string | undefined;
  localDisplayName: string;
  localVideoStream: MediaStream | null;
  localAudioStream: MediaStream | null;
  remotePeers: RemotePeerMedia[];
  /** Active screen share (local priority), already derived by the room view. */
  activeScreenShare: { userId: string; label: string; stream: MediaStream } | null;
  /** The participant the room currently detects as speaking, if any. */
  activeSpeakerId: string | null;
}

export interface UseCallRecordingResult {
  state: "idle" | "recording" | "saving";
  elapsedSeconds: number;
  isSupported: boolean;
  start: () => void;
  stop: () => void;
}

function getAudioTracksSafe(stream: MediaStream | null): MediaStreamTrack[] {
  if (stream == null || typeof stream.getAudioTracks !== "function") {
    return [];
  }
  return stream.getAudioTracks();
}

function hasLiveAudio(stream: MediaStream | null): boolean {
  return getAudioTracksSafe(stream).some((track) => track.readyState === "live");
}

/**
 * Records the whole call locally: composited video program of every
 * publishing participant plus one mixed audio track of everyone, fed to the
 * stream-agnostic MediaRecorder lifecycle.
 *
 * Membership and publishing changes only alter what the compositor draws and
 * what the mixer hears - the recorded stream persists, so the file is never
 * restarted mid-call.
 */
export function useCallRecording({
  roomSlug,
  localUserId,
  localDisplayName,
  localVideoStream,
  localAudioStream,
  remotePeers,
  activeScreenShare,
  activeSpeakerId,
}: UseCallRecordingOptions): UseCallRecordingResult {
  const compositorRef = useRef<CallRecordingCompositor | null>(null);
  const mixerRef = useRef<CallAudioMixer | null>(null);
  const shouldStartRef = useRef(false);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);

  const sources = useMemo<RecordingSource[]>(() => {
    const list: RecordingSource[] = [
      {
        id: localUserId ?? "me",
        label: localDisplayName,
        stream: localVideoStream,
        isLocal: true,
        isScreen: false,
        isSpeaking: activeSpeakerId !== null && activeSpeakerId === (localUserId ?? "me"),
      },
    ];
    for (const peer of remotePeers) {
      list.push({
        id: peer.userId,
        label: peer.username,
        stream: peer.cameraStream,
        isLocal: false,
        isScreen: false,
        isSpeaking: activeSpeakerId === peer.userId,
      });
    }
    if (activeScreenShare) {
      list.push({
        id: `screen:${activeScreenShare.userId}`,
        label: activeScreenShare.label,
        stream: activeScreenShare.stream,
        isLocal: false,
        isScreen: true,
      });
    }
    return list;
  }, [
    localUserId,
    localDisplayName,
    localVideoStream,
    remotePeers,
    activeScreenShare,
    activeSpeakerId,
  ]);

  const audioStreams = useMemo(() => {
    const list: Array<{ id: string; stream: MediaStream }> = [];
    if (localAudioStream != null && hasLiveAudio(localAudioStream)) {
      list.push({ id: localUserId ?? "me", stream: localAudioStream });
    }
    for (const peer of remotePeers) {
      if (hasLiveAudio(peer.audioStream)) {
        list.push({ id: peer.userId, stream: peer.audioStream });
      }
    }
    return list;
  }, [localUserId, localAudioStream, remotePeers]);

  // Keep the running program in sync with room membership and devices.
  useEffect(() => {
    compositorRef.current?.setSources(sources);
    mixerRef.current?.setStreams(audioStreams);
  }, [sources, audioStreams]);

  const {
    start: startRecorder,
    stop: stopRecorder,
    ...recorderState
  } = useMediaRecorder({
    stream: recordingStream,
    filenameBase: `zvonok-${roomSlug}`,
  });

  const start = useCallback(() => {
    if (recordingStream !== null || shouldStartRef.current) {
      return;
    }
    const compositor = new CallRecordingCompositor();
    compositor.setSources(sources);
    const videoProgram = compositor.start();
    const mixer = new CallAudioMixer();
    const audioProgram = mixer.start();
    mixer.setStreams(audioStreams);
    compositorRef.current = compositor;
    mixerRef.current = mixer;
    shouldStartRef.current = true;
    setRecordingStream(
      new MediaStream([...videoProgram.getVideoTracks(), ...audioProgram.getAudioTracks()]),
    );
  }, [recordingStream, sources, audioStreams]);

  // The recorder only sees the stream after a render; start it then.
  useEffect(() => {
    if (recordingStream !== null && shouldStartRef.current) {
      shouldStartRef.current = false;
      startRecorder();
    }
  }, [recordingStream, startRecorder]);

  const stop = useCallback(() => {
    stopRecorder();
    compositorRef.current?.stop();
    compositorRef.current = null;
    mixerRef.current?.stop();
    mixerRef.current = null;
    setRecordingStream(null);
  }, [stopRecorder]);

  // Leaving the room mid-recording tears the program down after the
  // MediaRecorder's own unmount save has flushed.
  useEffect(() => {
    return () => {
      compositorRef.current?.stop();
      compositorRef.current = null;
      mixerRef.current?.stop();
      mixerRef.current = null;
      shouldStartRef.current = false;
    };
  }, []);

  const isSupported =
    recorderState.isSupported &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    typeof AudioContext !== "undefined";

  return {
    ...recorderState,
    isSupported,
    start,
    stop,
  };
}
