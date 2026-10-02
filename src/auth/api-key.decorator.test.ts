import { describe, it, expect } from '@rstest/core';
import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ApiKey } from './api-key.decorator';

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

describe('ApiKey', () => {
  const factory = getFactory(ApiKey);

  it('should return req.apiKey', () => {
    const apiKey = { id: 'key-1', consumer: 'acme-corp' };
    expect(factory(undefined, contextFor({ apiKey }))).toEqual(apiKey);
  });

  it('should return undefined for non-partner requests', () => {
    expect(factory(undefined, contextFor({}))).toBeUndefined();
  });
});
