import {
  ROLE_CAPABILITIES,
  capabilitiesForRole,
  isParticipantRole,
} from './capabilities';

describe('roles and capabilities', () => {
  it('gives the viewer role no capabilities', () => {
    expect(ROLE_CAPABILITIES.viewer).toEqual([]);
  });

  it('gives the participant role exactly the send capabilities', () => {
    expect(ROLE_CAPABILITIES.participant).toEqual([
      'send-audio',
      'send-video',
      'send-screenshare',
    ]);
  });

  it('extends the host bundle with every host action', () => {
    expect(ROLE_CAPABILITIES.host).toEqual([
      'send-audio',
      'send-video',
      'send-screenshare',
      'mute-users',
      'remove-participants',
      'lock-room',
      'start-recording',
      'start-broadcast',
    ]);
  });

  it('resolves each role through capabilitiesForRole', () => {
    for (const role of ['host', 'participant', 'viewer'] as const) {
      expect(capabilitiesForRole(role)).toEqual(ROLE_CAPABILITIES[role]);
    }
  });

  it('returns fresh arrays so callers cannot mutate the bundles', () => {
    const bundle = capabilitiesForRole('host');
    bundle.pop();
    expect(ROLE_CAPABILITIES.host.length).toBe(8);
    expect(capabilitiesForRole('host')).toEqual(ROLE_CAPABILITIES.host);
  });

  it('recognizes only the three known roles', () => {
    expect(isParticipantRole('host')).toBe(true);
    expect(isParticipantRole('participant')).toBe(true);
    expect(isParticipantRole('viewer')).toBe(true);
    expect(isParticipantRole('admin')).toBe(false);
    expect(isParticipantRole(true)).toBe(false);
    expect(isParticipantRole(undefined)).toBe(false);
  });
});
