/** Name of the tracer that makes the request spans */
export const TRACER_NAME = '@tsdevstack/nest-common';

/** Name of the tracer BullMQ's queue and job spans use */
export const BULLMQ_TRACER_NAME = '@tsdevstack/nest-common/bullmq';

/**
 * Prisma spans left out: serializing the arguments takes well under a
 * millisecond and shows nothing the operation span doesn't; the
 * disconnect at shutdown runs outside any request and would be a trace
 * of its own each time an instance stops
 */
export const PRISMA_IGNORED_SPAN_TYPES = [
  'prisma:client:serialize',
  'prisma:client:disconnect',
];

/** Name of the tracer the messaging publish and process spans use */
export const MESSAGING_TRACER_NAME = '@tsdevstack/nest-common/messaging';
