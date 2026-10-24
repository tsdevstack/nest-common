import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const {
  mockCreateApplicationContext,
  mockApp: _mockApp,
  mockLoadEnvIfExists,
  mockReadPackageJson,
  mockServerInstance,
  mockCreateServer,
  mockOverrideLogger,
} = rs.hoisted(() => {
  const app = {
    close: rs.fn().mockResolvedValue(undefined),
  };
  const server = {
    listen: rs.fn(),
    close: rs.fn(),
  };
  return {
    mockCreateApplicationContext: rs.fn().mockResolvedValue(app),
    mockApp: app,
    mockLoadEnvIfExists: rs.fn(),
    mockReadPackageJson: rs.fn().mockReturnValue({
      name: 'test-worker',
    }),
    mockServerInstance: server,
    mockCreateServer: rs.fn().mockReturnValue(server),
    mockOverrideLogger: rs.fn(),
  };
});

rs.mock('@nestjs/common', () => ({
  Logger: class {
    static overrideLogger = mockOverrideLogger;
    log = rs.fn();
    error = rs.fn();
  },
}));

rs.mock('../logging/logger.service', () => ({
  LoggerService: class {},
}));

rs.mock('../logging/nest-logger-adapter', () => ({
  NestLoggerAdapter: class {
    readonly isNestLoggerAdapter = true;
  },
}));

rs.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: mockCreateApplicationContext,
  },
}));

rs.mock('http', () => ({
  createServer: mockCreateServer,
}));

rs.mock('./load-env-if-exists', () => ({
  loadEnvIfExists: mockLoadEnvIfExists,
}));

rs.mock('../utils/read-package-json', () => ({
  readPackageJson: mockReadPackageJson,
}));

import { startWorker } from './start-worker';

describe('startWorker', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    rs.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load env', async () => {
    await startWorker(class {});
    expect(mockLoadEnvIfExists).toHaveBeenCalled();
  });

  it('should set SERVICE_NAME from package.json', async () => {
    await startWorker(class {});
    expect(process.env.SERVICE_NAME).toBe('test-worker');
  });

  it('should create application context', async () => {
    const MockModule = class {};
    await startWorker(MockModule);
    expect(mockCreateApplicationContext).toHaveBeenCalledWith(
      MockModule,
      expect.anything(),
    );
  });

  it("should route Nest's logger through LoggerService from the first message", async () => {
    await startWorker(class {});

    const [adapter] = mockOverrideLogger.mock.calls[0] as [unknown];
    expect(adapter).toMatchObject({ isNestLoggerAdapter: true });
    expect(mockOverrideLogger.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateApplicationContext.mock.invocationCallOrder[0],
    );
    expect(mockCreateApplicationContext).toHaveBeenCalledWith(
      expect.anything(),
      { logger: adapter },
    );
  });

  it('should create health server', async () => {
    await startWorker(class {});
    expect(mockCreateServer).toHaveBeenCalled();
  });

  it('should listen on default port 8080', async () => {
    await startWorker(class {});
    expect(mockServerInstance.listen).toHaveBeenCalledWith(8080);
  });

  it('should listen on custom port', async () => {
    await startWorker(class {}, { healthPort: 9090 });
    expect(mockServerInstance.listen).toHaveBeenCalledWith(9090);
  });

  describe('Health endpoint', () => {
    it('should respond 200 to /health', async () => {
      await startWorker(class {});

      // Get the request handler passed to createServer
      const handler = mockCreateServer.mock.calls[0][0];
      const mockReq = { url: '/health' };
      const mockRes = {
        writeHead: rs.fn(),
        end: rs.fn(),
      };

      handler(mockReq, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200);
      expect(mockRes.end).toHaveBeenCalledWith('OK');
    });

    it('should respond 404 to other paths', async () => {
      await startWorker(class {});

      const handler = mockCreateServer.mock.calls[0][0];
      const mockRes = {
        writeHead: rs.fn(),
        end: rs.fn(),
      };

      handler({ url: '/other' }, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404);
    });
  });
});
