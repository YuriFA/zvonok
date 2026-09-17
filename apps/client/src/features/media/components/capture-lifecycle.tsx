import { useDeviceControls, useZvonokSession } from "@zvonok/react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Starts the shared capture for the room page (prejoin preview and the
 * call) with the persisted device selection, and releases it on unmount.
 * The start identity from the device surface is not stable, so the trigger
 * runs once per mount through a ref.
 */
export function CaptureLifecycle({ children }: { children: ReactNode }) {
  const { mediaManager } = useZvonokSession();
  const { start } = useDeviceControls();
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    void startRef.current();
    return () => mediaManager.stop();
  }, [mediaManager]);

  return <>{children}</>;
}
