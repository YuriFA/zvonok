/**
 * Participant roles and the capability vocabulary they resolve to.
 *
 * Roles are the permission statement carried by minted room tokens; the
 * server resolves them to concrete capabilities at join time and enforces
 * capabilities - never role names - on every guarded action. Future
 * configurable grants replace these mappings without touching the token or
 * the join acknowledgement contract.
 */

/** Roles a minted room token can carry. */
export type ParticipantRole = 'host' | 'participant' | 'viewer';

/**
 * Fixed capability vocabulary enforced by the server. `start-recording`
 * and `start-broadcast` ship ahead of their enforcement (client-initiated
 * egress) so the join acknowledgement contract stays stable.
 */
export type CapabilityId =
  | 'send-audio'
  | 'send-video'
  | 'send-screenshare'
  | 'mute-users'
  | 'remove-participants'
  | 'lock-room'
  | 'start-recording'
  | 'start-broadcast';

export const PARTICIPANT_ROLES: readonly ParticipantRole[] = [
  'host',
  'participant',
  'viewer',
];

const PARTICIPANT_CAPABILITIES: readonly CapabilityId[] = [
  'send-audio',
  'send-video',
  'send-screenshare',
];

const HOST_CAPABILITIES: readonly CapabilityId[] = [
  ...PARTICIPANT_CAPABILITIES,
  'mute-users',
  'remove-participants',
  'lock-room',
  'start-recording',
  'start-broadcast',
];

/** Default capability bundles per role. */
export const ROLE_CAPABILITIES: Record<
  ParticipantRole,
  readonly CapabilityId[]
> = {
  host: HOST_CAPABILITIES,
  participant: PARTICIPANT_CAPABILITIES,
  viewer: [],
};

export function isParticipantRole(value: unknown): value is ParticipantRole {
  return (
    typeof value === 'string' &&
    (PARTICIPANT_ROLES as readonly string[]).includes(value)
  );
}

/** Resolve a role to its capability bundle (fresh array per call). */
export function capabilitiesForRole(role: ParticipantRole): CapabilityId[] {
  return [...ROLE_CAPABILITIES[role]];
}
