import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from '@rstest/core';
import { trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { registerPrismaTracing } from './register-prisma-tracing';

interface PrismaTracingHelper {
  runInChildSpan<R>(options: { name: string }, callback: () => R): R;
}

/** The helper Prisma Client 7 reads on every query */
function prismaHelper(): PrismaTracingHelper | undefined {
  const global = globalThis as unknown as Record<
    string,
    { helper?: PrismaTracingHelper } | undefined
  >;
  return global.V7_PRISMA_INSTRUMENTATION?.helper;
}

describe('registerPrismaTracing', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
    registerPrismaTracing();
  });

  afterAll(() => {
    trace.disable();
  });

  beforeEach(() => {
    exporter.reset();
  });

  describe('Standard use cases', () => {
    it('should give Prisma Client a tracing helper', () => {
      expect(prismaHelper()).toBeDefined();
    });

    it("should record Prisma's operation spans", () => {
      const result = prismaHelper()?.runInChildSpan(
        { name: 'operation' },
        () => 42,
      );

      expect(result).toBe(42);
      expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
        'prisma:client:operation',
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should leave out the serialize spans', () => {
      prismaHelper()?.runInChildSpan({ name: 'serialize' }, () => undefined);

      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });

    it('should leave out the disconnect at shutdown', () => {
      prismaHelper()?.runInChildSpan({ name: 'disconnect' }, () => undefined);

      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });
  });
});
