import { Injectable } from '@nestjs/common';
import type { HealthIndicatorResult } from '../health.interface';

const DEFAULT_HEAP_THRESHOLD = 500 * 1024 * 1024; // 500MB

@Injectable()
export class MemoryHealthIndicator {
  private heapThreshold: number;

  constructor() {
    this.heapThreshold = DEFAULT_HEAP_THRESHOLD;
  }

  setThreshold(bytes: number): void {
    this.heapThreshold = bytes;
  }

  check(): HealthIndicatorResult {
    const memoryUsage = process.memoryUsage();
    const heapUsed = memoryUsage.heapUsed;

    if (heapUsed > this.heapThreshold) {
      return {
        status: 'down',
        details: {
          heapUsed: Math.round(heapUsed / 1024 / 1024),
          heapThreshold: Math.round(this.heapThreshold / 1024 / 1024),
          unit: 'MB',
        },
      };
    }

    return {
      status: 'up',
      details: {
        heapUsed: Math.round(heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        unit: 'MB',
      },
    };
  }
}