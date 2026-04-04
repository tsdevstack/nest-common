import { Module, OnModuleInit, Inject } from '@nestjs/common';
import type { DynamicModule, Provider, InjectionToken } from '@nestjs/common';
import { Reflector, ModuleRef } from '@nestjs/core';
import Redis from 'ioredis';
import { SecretsService } from '../secrets/secrets.service';
import { SecretsModule } from '../secrets/secrets.module';
import { RedisModule } from '../redis/redis.module';
import { MessagingService } from './messaging.service';
import type { MessagingModuleOptions } from './messaging.interface';
import {
  MESSAGING_OPTIONS_TOKEN,
  MESSAGING_CONSUMER_REDIS_TOKEN,
  ON_MESSAGE_METADATA,
} from './messaging.constants';

/**
 * Token to collect all providers that may contain @OnMessage handlers.
 * Providers register themselves here so the module can discover their handlers.
 */
const MESSAGING_HANDLER_PROVIDERS = 'MESSAGING_HANDLER_PROVIDERS';

@Module({})
export class MessagingModule implements OnModuleInit {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    @Inject(MESSAGING_HANDLER_PROVIDERS)
    private readonly handlerProviderTokens: unknown[],
  ) {}

  async onModuleInit(): Promise<void> {
    // Discover @OnMessage handlers from registered providers
    for (const token of this.handlerProviderTokens) {
      let instance: unknown;
      try {
        instance = this.moduleRef.get(token as string, { strict: false });
      } catch {
        continue;
      }

      if (!instance || typeof instance !== 'object') continue;

      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        unknown
      >;
      const methodNames = Object.getOwnPropertyNames(prototype).filter(
        (name) =>
          name !== 'constructor' && typeof prototype[name] === 'function',
      );

      for (const methodName of methodNames) {
        const topic = this.reflector.get<string>(
          ON_MESSAGE_METADATA,
          prototype[methodName] as (...args: unknown[]) => unknown,
        );

        if (topic) {
          const method = prototype[methodName] as (
            ...args: unknown[]
          ) => Promise<void>;
          const boundHandler = method.bind(instance);
          this.messagingService.registerHandler(topic, boundHandler);
        }
      }
    }

    // Start consumer loops after all handlers are registered
    await this.messagingService.start();
  }

  /**
   * Standard module registration.
   * Creates a dedicated Redis connection for consumer loops.
   *
   * @param options - Messaging configuration
   * @param handlerTypes - Classes containing @OnMessage methods (pass the same classes from providers[])
   */
  static forRoot(
    options: MessagingModuleOptions,
    handlerTypes: unknown[] = [],
  ): DynamicModule {
    const optionsProvider: Provider = {
      provide: MESSAGING_OPTIONS_TOKEN,
      useValue: options,
    };

    // Dedicated Redis connection for blocking XREADGROUP
    // (RedisService uses maxRetriesPerRequest: 3 which breaks BLOCK commands)
    const consumerRedisProvider: Provider = {
      provide: MESSAGING_CONSUMER_REDIS_TOKEN,
      useFactory: async (secrets: SecretsService): Promise<Redis> => {
        const hasTopics =
          options.topics !== undefined && options.topics.length > 0;

        if (!hasTopics) {
          // Publish-only — return a dummy that won't be used for consuming
          // Still create a real connection so the token resolves
          return new Redis({
            host: await secrets.get('REDIS_HOST'),
            port: parseInt(await secrets.get('REDIS_PORT'), 10) || 6379,
            password: await secrets.get('REDIS_PASSWORD'),
            ...((await secrets.get('REDIS_TLS')) === 'true' && {
              tls: {},
            }),
            maxRetriesPerRequest: null,
            lazyConnect: true,
          });
        }

        const redis = new Redis({
          host: await secrets.get('REDIS_HOST'),
          port: parseInt(await secrets.get('REDIS_PORT'), 10) || 6379,
          password: await secrets.get('REDIS_PASSWORD'),
          ...((await secrets.get('REDIS_TLS')) === 'true' && {
            tls: {},
          }),
          // CRITICAL: null required for blocking XREADGROUP commands
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
          lazyConnect: true,
          keepAlive: 30000,
          connectTimeout: 10000,
        });

        await redis.connect();
        return redis;
      },
      inject: [SecretsService],
    };

    // Collect handler provider tokens so we can discover @OnMessage methods
    const handlerProvidersToken: Provider = {
      provide: MESSAGING_HANDLER_PROVIDERS,
      useValue: handlerTypes,
    };

    return {
      module: MessagingModule,
      imports: [SecretsModule, RedisModule],
      providers: [
        optionsProvider,
        consumerRedisProvider,
        handlerProvidersToken,
        MessagingService,
      ],
      exports: [MessagingService],
      global: true,
    };
  }

  /**
   * Async module registration for dynamic configuration.
   */
  static forRootAsync(config: {
    useFactory: (
      ...args: unknown[]
    ) => Promise<MessagingModuleOptions> | MessagingModuleOptions;
    inject?: InjectionToken[];
    handlerTypes?: unknown[];
  }): DynamicModule {
    const optionsProvider: Provider = {
      provide: MESSAGING_OPTIONS_TOKEN,
      useFactory: config.useFactory,
      inject: config.inject ?? [],
    };

    const consumerRedisProvider: Provider = {
      provide: MESSAGING_CONSUMER_REDIS_TOKEN,
      useFactory: async (
        secrets: SecretsService,
        options: MessagingModuleOptions,
      ): Promise<Redis> => {
        const hasTopics =
          options.topics !== undefined && options.topics.length > 0;

        const redis = new Redis({
          host: await secrets.get('REDIS_HOST'),
          port: parseInt(await secrets.get('REDIS_PORT'), 10) || 6379,
          password: await secrets.get('REDIS_PASSWORD'),
          ...((await secrets.get('REDIS_TLS')) === 'true' && {
            tls: {},
          }),
          maxRetriesPerRequest: null,
          lazyConnect: !hasTopics,
          keepAlive: 30000,
          connectTimeout: 10000,
        });

        if (hasTopics) {
          await redis.connect();
        }

        return redis;
      },
      inject: [SecretsService, MESSAGING_OPTIONS_TOKEN],
    };

    const handlerProvidersToken: Provider = {
      provide: MESSAGING_HANDLER_PROVIDERS,
      useValue: config.handlerTypes ?? [],
    };

    return {
      module: MessagingModule,
      imports: [SecretsModule, RedisModule],
      providers: [
        optionsProvider,
        consumerRedisProvider,
        handlerProvidersToken,
        MessagingService,
      ],
      exports: [MessagingService],
      global: true,
    };
  }
}
