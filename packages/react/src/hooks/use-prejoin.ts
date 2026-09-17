/**
 * Prejoin state machine: the skippable name-confirmation flow in front of
 * every join. The consumer supplies the join action; guest approval states
 * and device selection stay consumer-side.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type PrejoinPhase = "confirming" | "joining" | "confirmed";

export interface UsePrejoinOptions {
  /** Starting draft for the display name field. */
  initialName?: string;
  /**
   * Join without the confirmation step (identity already known or the
   * consumer pre-approved this participant). When it flips to true the
   * confirmation fires once automatically.
   */
  skip?: boolean;
  /**
   * The consumer's join action. Resolve it when the pre-join stage is over
   * for the local flow; reject to return to the confirmation stage.
   */
  onConfirm: (options: { displayName: string }) => Promise<void> | void;
}

export interface UsePrejoinResult {
  phase: PrejoinPhase;
  displayName: string;
  setDisplayName: (name: string) => void;
  /** False only while the trimmed name is empty. */
  canConfirm: boolean;
  confirm: () => Promise<void>;
  /** Back to the confirmation stage after a failure or consumer reset. */
  reset: () => void;
}

export function usePrejoin(options: UsePrejoinOptions): UsePrejoinResult {
  const { initialName = "", skip = false, onConfirm } = options;

  const [phase, setPhase] = useState<PrejoinPhase>("confirming");
  const [displayName, setDisplayName] = useState(initialName);

  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  const confirm = useCallback(async () => {
    setPhase((current) => {
      // A confirmation is already running or done; ignore re-entry.
      return current === "confirming" ? "joining" : current;
    });
  }, []);

  // Drive the async join whenever the phase enters "joining".
  useEffect(() => {
    if (phase !== "joining") {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await onConfirmRef.current({ displayName });
        if (!cancelled) {
          setPhase("confirmed");
        }
      } catch {
        if (!cancelled) {
          setPhase("confirming");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // The draft the confirmation was started with is the one that joins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Skipped prejoins auto-confirm exactly once, reacting to `skip` flipping
  // true while identity or approval is still resolving.
  const skipStartedRef = useRef(false);
  useEffect(() => {
    if (skip && !skipStartedRef.current && phase === "confirming") {
      skipStartedRef.current = true;
      setPhase("joining");
    }
  }, [skip, phase]);

  const reset = useCallback(() => {
    setPhase("confirming");
  }, []);

  return {
    phase,
    displayName,
    setDisplayName,
    canConfirm: displayName.trim().length > 0,
    confirm,
    reset,
  };
}
