import { describe, it, expect } from '@rstest/core';
import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Partner } from './partner.decorator';

type ParamFactory = (data: unknown, ctx: ExecutionContext) => unknown;

/** Reads the factory Nest stores for a parameter decorator */
const getFactory = (decorator: () => ParameterDecorator): ParamFactory => {
  class TestController {
    handler(): void {}
  }
  decorator()(TestController.prototype, 'handler', 0);
  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TestController,
    'handler',
  ) as Record<string, { factory: ParamFactory }>;
  return Object.values(args)[0].factory;
};

const contextFor = (request: Record<string, unknown>): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('Partner', () => {
  const factory = getFactory(Partner);

  it('should return the API key consumer', () => {
    expect(
      factory(
        undefined,
        contextFor({ apiKey: { id: 'key-1', consumer: 'acme-corp' } }),
      ),
    ).toBe('acme-corp');
  });

  it('should ignore a client-sent X-Consumer-Username header', () => {
    expect(
      factory(
        undefined,
        contextFor({ headers: { 'x-consumer-username': 'forged' } }),
      ),
    ).toBeUndefined();
  });
});
