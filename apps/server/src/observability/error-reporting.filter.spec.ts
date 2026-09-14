import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { InternalServerErrorException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import { ErrorReportingFilter } from './error-reporting.filter';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

const captureMock = jest.mocked(Sentry.captureException);

describe('ErrorReportingFilter', () => {
  const host = {} as ArgumentsHost;
  const filter = new ErrorReportingFilter();
  const baseCatch = jest
    .spyOn(BaseExceptionFilter.prototype, 'catch')
    .mockImplementation(() => undefined);

  beforeEach(() => {
    captureMock.mockClear();
    baseCatch.mockClear();
  });

  it('reports plain throws and still serves the default response', () => {
    const error = new Error('boom');
    filter.catch(error, host);
    expect(captureMock).toHaveBeenCalledWith(error);
    expect(baseCatch).toHaveBeenCalledWith(error, host);
  });

  it('reports 5xx HttpExceptions', () => {
    const error = new InternalServerErrorException('db down');
    filter.catch(error, host);
    expect(captureMock).toHaveBeenCalledWith(error);
  });

  it('treats 4xx HttpExceptions as control flow, not faults', () => {
    const error = new BadRequestException('bad input');
    filter.catch(error, host);
    expect(captureMock).not.toHaveBeenCalled();
    expect(baseCatch).toHaveBeenCalledWith(error, host);
  });
});
