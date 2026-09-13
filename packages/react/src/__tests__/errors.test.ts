import { describe, expect, it } from "vitest";

import {
  ZvonokBroadcastError,
  ZvonokEgressError,
  ZvonokError,
  ZvonokHostError,
  ZvonokJoinError,
} from "../errors.js";

describe("ZvonokError recoverable flag", () => {
  it("marks an expired room token as recoverable", () => {
    const error = new ZvonokJoinError("ROOM_TOKEN_EXPIRED", "Token expired");
    expect(error.recoverable).toBe(true);
  });

  it("marks terminal server codes as unrecoverable", () => {
    for (const code of ["ROOM_TOKEN_INVALID", "ROOM_TOKEN_ROOM_MISMATCH", "ROOM_LOCKED"]) {
      expect(new ZvonokJoinError(code, "refused").recoverable).toBe(false);
    }
  });

  it("marks client-side timeouts and host/egress/broadcast denials as unrecoverable", () => {
    expect(new ZvonokJoinError("JOIN_TIMEOUT", "no ack").recoverable).toBe(false);
    expect(new ZvonokHostError("MISSING_CAPABILITY", "denied").recoverable).toBe(false);
    expect(new ZvonokEgressError("ALREADY_ACTIVE", "denied").recoverable).toBe(false);
    expect(new ZvonokBroadcastError("NOT_IN_ROOM", "denied").recoverable).toBe(false);
    expect(new ZvonokError("RECONNECT_FAILED", "exhausted").recoverable).toBe(false);
  });

  it("carries the code and message unchanged", () => {
    const error = new ZvonokJoinError("ROOM_LOCKED", "Room is locked");
    expect(error.code).toBe("ROOM_LOCKED");
    expect(error.message).toBe("Room is locked");
    expect(error.name).toBe("ZvonokJoinError");
  });
});
