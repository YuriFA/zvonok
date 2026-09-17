/**
 * Typed join failures surface here instead of a blank room. The error is
 * always a ZvonokError subclass by the time status is "error", but the
 * card degrades gracefully for anything else.
 */

import { ZvonokError } from "../errors.js";

export interface JoinErrorCardProps {
  error: Error;
  onBack: () => void;
}

export function JoinErrorCard({ error, onBack }: JoinErrorCardProps) {
  const code = error instanceof ZvonokError ? error.code : null;
  return (
    <div className="zk zk-room zk-error" role="alert">
      <div className="zk-error-card">
        <h1 className="zk-title">Could not join the room</h1>
        {code && <span className="zk-error-code">{code}</span>}
        <p className="zk-error-message">{error.message}</p>
        <button type="button" className="zk-button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
