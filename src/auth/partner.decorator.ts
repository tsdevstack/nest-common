import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts partner identifier from Kong's X-Consumer-Username header.
 *
 * Kong automatically adds this header when a valid API key is used.
 * The value is the partner's username as defined in .secrets.user.json.
 *
 * @returns Partner username string, or undefined if not present
 *
 * @example Basic usage
 * ```typescript
 * @Controller('webhooks')
 * export class WebhooksController {
 *   @PartnerApi()
 *   @Post('data')
 *   async receiveData(@Partner() partner: string) {
 *     // partner = "acme-corp" (from X-Consumer-Username header)
 *     this.logger.info('Partner API call', { partner });
 *     return this.processData();
 *   }
 * }
 * ```
 *
 * @example With optional typing (dual JWT + Partner access)
 * ```typescript
 * @Controller('exports')
 * export class ExportsController {
 *   @ApiBearerAuth()
 *   @PartnerApi()
 *   @Get('data')
 *   async exportData(
 *     @User() user?: AuthUser,
 *     @Partner() partner?: string,
 *   ) {
 *     if (partner) {
 *       // Called via /api/exports/data with API key
 *       this.logger.info('Partner export', { partner });
 *     } else if (user) {
 *       // Called via /exports/data with JWT
 *       this.logger.info('User export', { userId: user.id });
 *     }
 *     return this.getExportData();
 *   }
 * }
 * ```
 *
 * @example With logging and tracking
 * ```typescript
 * @PartnerApi()
 * @Post('webhook')
 * async handleWebhook(
 *   @Partner() partner: string,
 *   @Body() data: WebhookDto,
 * ) {
 *   await this.analytics.trackPartnerUsage(partner, '/webhook');
 *   await this.webhookService.process(partner, data);
 *   return { success: true };
 * }
 * ```
 */
export const Partner = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.headers['x-consumer-username'] as string | undefined;
  },
);