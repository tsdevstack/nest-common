import { Injectable, Logger } from '@nestjs/common';

/**
 * Configuration for initializing a service client.
 *
 * @template TApi - The generated API client type (e.g., Api from swagger-typescript-api)
 */
export interface ServiceClientConfig<TApi> {
  /**
   * The service base URL
   */
  baseURL: string;

  /**
   * The service API key for authentication
   */
  apiKey: string;

  /**
   * Factory function to create the API client instance
   * @param baseURL - The service base URL
   * @param apiKey - The service API key
   * @returns Instance of the generated API client
   */
  createClient: (baseURL: string, apiKey: string) => TApi;
}

/**
 * Base class for service-to-service HTTP client wrappers.
 *
 * This class standardizes the pattern for initializing generated TypeScript API clients
 * with proper authentication for service-to-service communication.
 *
 * ## Features
 * - Automatic initialization during module init
 * - API key injection for service-to-service authentication
 * - Support for JWT forwarding via securityWorker (user context)
 * - Standardized error handling and logging
 * - Type-safe client access
 *
 * ## Usage
 *
 * @example Basic service client
 * ```typescript
 * import { Injectable, OnModuleInit } from '@nestjs/common';
 * import { BaseServiceClient } from '@tsdevstack/nest-common';
 * import { Api } from '@shared/auth-service-client';
 * import { SecretsService } from '@tsdevstack/nest-common';
 *
 * @Injectable()
 * export class AuthClientService extends BaseServiceClient<Api<{ token: string }>> implements OnModuleInit {
 *   constructor(private secrets: SecretsService) {
 *     super();
 *   }
 *
 *   async onModuleInit(): Promise<void> {
 *     const baseURL = await this.secrets.get('AUTH_SERVICE_URL');
 *     const apiKey = await this.secrets.get('AUTH_SERVICE_API_KEY');
 *
 *     this.initialize({
 *       baseURL,
 *       apiKey,
 *       createClient: (baseURL, apiKey) =>
 *         new Api({
 *           baseURL,
 *           headers: { 'x-api-key': apiKey },
 *           securityWorker: (securityData) =>
 *             securityData?.token
 *               ? { headers: { Authorization: `Bearer ${securityData.token}` } }
 *               : {},
 *         }),
 *     });
 *   }
 * }
 * ```
 *
 * @example Using the client in a controller
 * ```typescript
 * @Controller('users')
 * export class UsersController {
 *   constructor(private authClient: AuthClientService) {}
 *
 *   @Get('account')
 *   async getAccount(@Request() req: AuthenticatedRequest) {
 *     // Forward user JWT for user-specific requests
 *     const user = await this.authClient.client.v1.getUserAccount();
 *     return user.data;
 *   }
 *
 *   @Get('internal')
 *   async internalOperation() {
 *     // Service-to-service call (uses API key automatically)
 *     const result = await this.authClient.client.v1.someInternalEndpoint();
 *     return result.data;
 *   }
 * }
 * ```
 *
 * @template TApi - The generated API client type
 */
@Injectable()
export abstract class BaseServiceClient<TApi> {
  /**
   * The initialized API client instance.
   * Available after initialization.
   */
  public client!: TApi;

  protected readonly logger: Logger;

  constructor() {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Initializes the service client with the provided configuration.
   * Should be called in the subclass's onModuleInit() method.
   *
   * @param config - Configuration containing baseURL, apiKey, and client factory
   * @throws Error if configuration is invalid
   */
  protected initialize(config: ServiceClientConfig<TApi>): void {
    try {
      if (!config.baseURL) {
        throw new Error('Service base URL is required');
      }

      if (!config.apiKey) {
        throw new Error('Service API key is required');
      }

      this.client = config.createClient(config.baseURL, config.apiKey);
      this.logger.log(`Service client initialized: ${config.baseURL}`);
    } catch (error) {
      this.logger.error(
        `Failed to initialize service client: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    }
  }
}