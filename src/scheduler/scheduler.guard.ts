import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { SecretsService } from '../secrets/secrets.service';

/**
 * SchedulerGuard
 *
 * Multi-cloud guard for scheduled job endpoints.
 * Validates that requests come from the cloud scheduler, not external sources.
 *
 * Security model:
 * - GCP: Full OIDC token validation (implemented)
 * - AWS: EventBridge integration (not yet implemented - fails safe)
 * - Azure: Logic Apps integration (not yet implemented - fails safe)
 * - Development/Local: Skips validation for easy local testing
 *
 * Combined with @ApiExcludeController(), provides two-layer security:
 * 1. @ApiExcludeController() keeps routes out of OpenAPI → no Kong route generated
 * 2. SchedulerGuard validates OIDC token if someone hits endpoint directly
 *
 * Usage:
 * ```typescript
 * @ApiExcludeController()  // Layer 1: Exclude from Kong
 * @Controller('jobs')
 * export class JobsController {
 *   @Post('cleanup-tokens')
 *   @UseGuards(SchedulerGuard)  // Layer 2: Validate scheduler token
 *   async cleanupTokens() {
 *     // Only accessible from Cloud Scheduler
 *   }
 * }
 * ```
 *
 * Local testing:
 * ```bash
 * # SECRETS_PROVIDER=local skips validation
 * curl -X POST http://localhost:3001/jobs/cleanup-tokens
 * ```
 */
@Injectable()
export class SchedulerGuard implements CanActivate {
  private readonly logger = new Logger(SchedulerGuard.name);
  private readonly oauth2Client = new OAuth2Client();

  constructor(private readonly secrets: SecretsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Use SECRETS_PROVIDER env var - same as SecretsService uses
    // This is set during deployment and determines the cloud provider
    const secretsProvider = process.env.SECRETS_PROVIDER;

    // Skip validation in local development
    if (secretsProvider === 'local') {
      this.logger.warn('Skipping scheduler validation in local mode');
      return true;
    }

    switch (secretsProvider) {
      case 'gcp':
        return this.validateGcpOidc(request);
      case 'aws':
        return this.validateAwsJobSecret(request);
      case 'azure':
        return this.validateAzureJobSecret(request);
      default:
        this.logger.error(
          `Unknown or missing SECRETS_PROVIDER: ${secretsProvider}`,
        );
        return false;
    }
  }

  /**
   * Validates AWS EventBridge job invocation via shared secret.
   *
   * AWS EventBridge cannot make authenticated HTTP calls directly, so we use
   * a Job Invoker Lambda that adds the X-Job-Secret header from Secrets Manager.
   * This validates that header matches the expected secret.
   *
   * @param request - HTTP request with X-Job-Secret header
   * @returns true if secret matches, false otherwise
   */
  private async validateAwsJobSecret(request: {
    headers: Record<string, string | undefined>;
  }): Promise<boolean> {
    const jobSecret = request.headers['x-job-secret'];
    if (!jobSecret) {
      this.logger.warn('Missing X-Job-Secret header');
      return false;
    }

    try {
      const expectedSecret = await this.secrets.get('JOB_AUTH_SECRET');
      if (!expectedSecret) {
        this.logger.error('JOB_AUTH_SECRET not configured');
        return false;
      }

      if (jobSecret === expectedSecret) {
        this.logger.log('Validated AWS scheduler request via job secret');
        return true;
      }

      this.logger.warn('Invalid X-Job-Secret header');
      return false;
    } catch (error) {
      this.logger.error('AWS job secret validation failed', error);
      return false;
    }
  }

  /**
   * Validates Azure Container App Job invocation via shared secret.
   *
   * Azure Container App Jobs inject the JOB_SECRET env var from Terraform.
   * The job's curl command sends it as X-Job-Secret header.
   * This validates that header matches the expected secret from Key Vault.
   */
  private async validateAzureJobSecret(request: {
    headers: Record<string, string | undefined>;
  }): Promise<boolean> {
    const jobSecret = request.headers['x-job-secret'];
    if (!jobSecret) {
      this.logger.warn('Missing X-Job-Secret header');
      return false;
    }

    try {
      const expectedSecret = await this.secrets.get('JOB_SECRET');
      if (!expectedSecret) {
        this.logger.error('JOB_SECRET not configured');
        return false;
      }

      if (jobSecret === expectedSecret) {
        this.logger.log('Validated Azure scheduler request via job secret');
        return true;
      }

      this.logger.warn('Invalid X-Job-Secret header');
      return false;
    } catch (error) {
      this.logger.error('Azure job secret validation failed', error);
      return false;
    }
  }

  /**
   * Validates GCP Cloud Scheduler OIDC token.
   *
   * Cloud Scheduler sends requests with an OIDC token in the Authorization header.
   * We verify the token was issued by Google for our service URL.
   *
   * @param request - HTTP request with Authorization header
   * @returns true if token is valid, false otherwise
   */
  private async validateGcpOidc(request: {
    headers: Record<string, string | undefined>;
  }): Promise<boolean> {
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      this.logger.warn('Missing Authorization header');
      return false;
    }

    try {
      // Get service URL from shared secrets using existing naming convention
      // Format: {SERVICE_NAME}_URL (e.g., AUTH_SERVICE_URL, BFF_SERVICE_URL)
      // These are automatically created when deploying services
      const serviceName = process.env.SERVICE_NAME;
      if (!serviceName) {
        this.logger.error('SERVICE_NAME environment variable not set');
        return false;
      }

      // Build secret key: auth-service → AUTH_SERVICE_URL
      const urlSecretKey = `${serviceName.toUpperCase().replace(/-/g, '_')}_URL`;
      const serviceUrl = await this.secrets.get(urlSecretKey);

      const ticket = await this.oauth2Client.verifyIdToken({
        idToken: authHeader.substring(7),
        audience: serviceUrl,
      });

      const payload = ticket.getPayload();
      this.logger.log(`Validated GCP scheduler request from ${payload?.email}`);
      return true;
    } catch (error) {
      this.logger.error('GCP OIDC token validation failed', error);
      return false;
    }
  }
}
