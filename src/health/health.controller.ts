import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';
import type { HealthCheckResult } from './health.interface';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  async healthCheck(): Promise<HealthCheckResult> {
    return this.healthService.check();
  }

  @Public()
  @Get('ping')
  ping(): { message: string; timestamp: string } {
    return { message: 'pong', timestamp: new Date().toISOString() };
  }
}