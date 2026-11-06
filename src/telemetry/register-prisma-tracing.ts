import {
  PrismaInstrumentation,
  registerInstrumentations,
} from '@prisma/instrumentation';
import { PRISMA_IGNORED_SPAN_TYPES } from './telemetry.constants';

/**
 * Prisma's spans (each operation and its SQL) join the active trace.
 * Prisma looks this up on every query, so it works for clients created
 * before or after this call.
 */
export function registerPrismaTracing(): void {
  registerInstrumentations({
    instrumentations: [
      new PrismaInstrumentation({
        ignoreSpanTypes: PRISMA_IGNORED_SPAN_TYPES,
      }),
    ],
  });
}
