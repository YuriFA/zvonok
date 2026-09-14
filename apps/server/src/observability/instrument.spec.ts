import * as Sentry from '@sentry/nestjs';
import { initErrorReporting, scrubErrorEvent } from './instrument';

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
}));

const initMock = jest.mocked(Sentry.init);

describe('initErrorReporting', () => {
  it('stays uninitialized without a DSN', () => {
    initErrorReporting({});
    expect(initMock).not.toHaveBeenCalled();
  });

  it('initializes with the DSN and environment', () => {
    const dsn = 'http://key@localhost/1';
    initErrorReporting({ SENTRY_DSN: dsn, NODE_ENV: 'test' });
    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({ dsn, environment: 'test' }),
    );
  });
});

describe('scrubErrorEvent', () => {
  it('strips cookies and auth headers, keeps route and stack', () => {
    const event = {
      request: {
        url: 'http://localhost/rooms',
        headers: {
          authorization: 'Bearer x',
          cookie: 'sid=y',
          'content-type': 'application/json',
        },
        cookies: { sid: 'y' },
      },
      exception: { values: [{ value: 'boom' }] },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubErrorEvent(event);

    expect(scrubbed).toBe(event);
    expect(scrubbed.request?.cookies).toBeUndefined();
    expect(scrubbed.request?.headers).toEqual({
      'content-type': 'application/json',
    });
    expect(scrubbed.request?.url).toBe('http://localhost/rooms');
    expect(scrubbed.exception?.values?.[0]?.value).toBe('boom');
  });

  it('passes through events without request data', () => {
    const event = {} as Sentry.ErrorEvent;
    expect(scrubErrorEvent(event)).toBe(event);
  });
});
