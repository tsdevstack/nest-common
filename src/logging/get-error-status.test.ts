import { describe, it, expect } from '@rstest/core';
import {
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getErrorStatus } from './get-error-status';

describe('getErrorStatus', () => {
  describe('Standard use cases', () => {
    it('should use the status of an HttpException', () => {
      expect(getErrorStatus(new NotFoundException())).toBe(404);
      expect(getErrorStatus(new BadRequestException('bad'))).toBe(400);
      expect(getErrorStatus(new ServiceUnavailableException())).toBe(503);
      expect(getErrorStatus(new HttpException('teapot', 418))).toBe(418);
    });

    it('should answer 500 for other errors', () => {
      expect(getErrorStatus(new Error('boom'))).toBe(500);
    });
  });

  describe('Edge cases', () => {
    it('should use the status of an http-errors style error', () => {
      expect(getErrorStatus({ statusCode: 413, message: 'too large' })).toBe(
        413,
      );
    });

    it('should answer 500 when a status code has no message', () => {
      expect(getErrorStatus({ statusCode: 404 })).toBe(500);
    });

    it('should answer 500 for values that are not errors', () => {
      expect(getErrorStatus('boom')).toBe(500);
      expect(getErrorStatus(null)).toBe(500);
      expect(getErrorStatus(undefined)).toBe(500);
    });
  });
});
