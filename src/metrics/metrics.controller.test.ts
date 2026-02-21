import { describe, it, expect, rs, beforeEach } from '@rstest/core';

import { MetricsController } from './metrics.controller';
import type { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  let controller: MetricsController;
  let mockMetricsService: Partial<MetricsService>;
  let mockReq: Record<string, unknown>;
  let mockRes: {
    set: ReturnType<typeof rs.fn>;
    send: ReturnType<typeof rs.fn>;
  };

  beforeEach(() => {
    rs.clearAllMocks();

    mockMetricsService = {
      getTelemetryService: rs.fn(),
    };

    mockReq = {};
    mockRes = {
      set: rs.fn(),
      send: rs.fn(),
    };

    controller = new MetricsController(mockMetricsService as MetricsService);
  });

  describe('getMetrics', () => {
    it('should return placeholder when telemetry service is null', async () => {
      rs.mocked(mockMetricsService.getTelemetryService!).mockReturnValue(
        undefined as never,
      );

      await controller.getMetrics(mockReq as never, mockRes as never);

      expect(mockRes.set).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain; charset=utf-8',
      );
      expect(mockRes.send).toHaveBeenCalledWith(
        '# OpenTelemetry not configured\n',
      );
    });

    it('should return placeholder when exporter is null', async () => {
      rs.mocked(mockMetricsService.getTelemetryService!).mockReturnValue({
        getPrometheusExporter: rs.fn().mockReturnValue(null),
      } as never);

      await controller.getMetrics(mockReq as never, mockRes as never);

      expect(mockRes.send).toHaveBeenCalledWith(
        '# OpenTelemetry not configured\n',
      );
    });

    it('should delegate to prometheus exporter when available', async () => {
      const mockHandler = rs.fn();
      rs.mocked(mockMetricsService.getTelemetryService!).mockReturnValue({
        getPrometheusExporter: rs.fn().mockReturnValue({
          getMetricsRequestHandler: mockHandler,
        }),
      } as never);

      await controller.getMetrics(mockReq as never, mockRes as never);

      expect(mockHandler).toHaveBeenCalledWith(mockReq, mockRes);
    });
  });
});
