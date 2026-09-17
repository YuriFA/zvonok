/**
 * Capability gate: the server delivers a capability vocabulary per
 * participant; host affordances render only when the session's capabilities
 * cover what they require. Role and ownership knowledge never lives here.
 */

import type { ReactNode } from "react";

export type RequiredCapabilities = string | string[];

function missing(capabilities: readonly string[], required: RequiredCapabilities): boolean {
  if (required.length === 0) {
    return false;
  }
  const owned = new Set(capabilities);
  return (Array.isArray(required) ? required : [required]).some(
    (capability) => !owned.has(capability),
  );
}

/** True when the owned capabilities cover every requirement. */
export function hasCapabilities(
  capabilities: readonly string[] | undefined,
  required: RequiredCapabilities | undefined,
): boolean {
  if (!required || required.length === 0) {
    return true;
  }
  return !missing(capabilities ?? [], required);
}

export interface CapabilitiesGateProps {
  /** The session's server-delivered capabilities. */
  capabilities: readonly string[] | undefined;
  /** Every listed capability must be present. */
  required: RequiredCapabilities;
  children: ReactNode;
  /** Rendered instead of the children when a requirement is missing. */
  fallback?: ReactNode;
}

export function CapabilitiesGate({
  capabilities,
  required,
  children,
  fallback = null,
}: CapabilitiesGateProps) {
  return <>{hasCapabilities(capabilities, required) ? children : fallback}</>;
}
