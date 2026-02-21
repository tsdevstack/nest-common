import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { MetricsService } from './metrics.service';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Get()
  async getMetrics(@Req() req: Request, @Res() res: Response): Promise<void> {
    const telemetryService = this.metricsService.getTelemetryService();
    const exporter = telemetryService?.getPrometheusExporter();

    if (!exporter) {
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send('# OpenTelemetry not configured\n');
      return;
    }

    // Use the PrometheusExporter's built-in request handler
    exporter.getMetricsRequestHandler(req, res);
  }
}