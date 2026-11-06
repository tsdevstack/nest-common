import { Module } from '@nestjs/common';

/**
 * The module ObservabilityModule.forRoot() returns.
 *
 * Its own @Module() metadata is empty on purpose. Nest adds a dynamic
 * module's imports and providers to the @Module() metadata of its class, so
 * building on ObservabilityModule would register its static defaults as well:
 * every interceptor twice, and `logging: false`, `metrics: false` or
 * `health: false` could not remove them.
 */
@Module({})
export class ObservabilityRootModule {}
