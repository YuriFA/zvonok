/**
 * Screen-share error mapping: the typed ScreenShareError vocabulary from
 * @zvonok/client mapped onto consumer-supplied presentation. Consumers own
 * the texts and the sinks (toasts, banners); this seam owns the branching.
 */

import type { ScreenShareError } from "@zvonok/client/screen-share/types";

export interface ScreenShareErrorPresentation<E> {
  /** Nothing happens: the browser cannot share at all. */
  unsupported?: E;
  /** The SFU already carries another participant's share. */
  blocked?: E;
  /** The user dismissed the picker. Defaults to no presentation. */
  cancelled?: E;
  /** The user or the browser denied the permission. Defaults to no presentation. */
  denied?: E;
  /** Any other failure (unexpected rejections, unknown errors). */
  fallback?: E;
}

/**
 * Map a caught screen-share failure onto the consumer's presentation value.
 * Returns undefined when the failure kind has no presentation - usually the
 * signal to stay silent.
 */
export function mapScreenShareError<E>(
  error: unknown,
  presentation: ScreenShareErrorPresentation<E>,
): E | undefined {
  const kind = error as ScreenShareError;
  switch (kind) {
    case "unsupported":
      return presentation.unsupported;
    case "blocked":
      return presentation.blocked;
    case "cancelled":
      return presentation.cancelled;
    case "denied":
      return presentation.denied;
    default:
      return presentation.fallback;
  }
}
