import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { Readable } from 'node:stream';
import { GCSStorageProvider } from './gcs.provider';
import type { GCSProviderConfig } from './gcs.provider';
import { StorageError, StorageErrorCode } from '../storage-error';

const mocks = {
  save: rs.fn(),
  download: rs.fn(),
  delete: rs.fn(),
  exists: rs.fn(),
  getMetadata: rs.fn(),
  getSignedUrl: rs.fn(),
  copy: rs.fn(),
  createReadStream: rs.fn(),
  createWriteStream: rs.fn(),
  getFiles: rs.fn(),
  file: rs.fn(),
};

rs.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket = () => ({
      file: (name: string) => {
        mocks.file(name);
        return {
          save: mocks.save,
          download: mocks.download,
          delete: mocks.delete,
          exists: mocks.exists,
          getMetadata: mocks.getMetadata,
          getSignedUrl: mocks.getSignedUrl,
          copy: mocks.copy,
          createReadStream: mocks.createReadStream,
          createWriteStream: mocks.createWriteStream,
          name,
          metadata: {},
        };
      },
      getFiles: mocks.getFiles,
    });
  },
}));

function createReadableStream(data: string): Readable {
  return Readable.from([Buffer.from(data)]);
}

function createGcsError(code: number, message?: string): Error {
  const error = new Error(message || `GCS error ${code}`);
  (error as unknown as Record<string, unknown>).code = code;
  return error;
}

describe('GCSStorageProvider', () => {
  let provider: GCSStorageProvider;
  const defaultConfig: GCSProviderConfig = {
    bucket: 'test-bucket',
    projectId: 'test-project',
  };

  beforeEach(() => {
    rs.clearAllMocks();
    provider = new GCSStorageProvider(defaultConfig);
  });

  describe('constructor', () => {
    it('should create provider with config', () => {
      const p = new GCSStorageProvider({ bucket: 'my-bucket' });
      expect(p).toBeDefined();
    });

    it('should create provider with projectId', () => {
      const p = new GCSStorageProvider({
        bucket: 'my-bucket',
        projectId: 'my-project',
      });
      expect(p).toBeDefined();
    });
  });

  describe('upload', () => {
    it('should upload a buffer', async () => {
      mocks.save.mockResolvedValue(undefined);
      mocks.getMetadata.mockResolvedValue([{ etag: '"abc123"' }]);

      const result = await provider.upload(
        'test/file.txt',
        Buffer.from('hello'),
        { contentType: 'text/plain' },
      );

      expect(result.etag).toBe('"abc123"');
      expect(mocks.save).toHaveBeenCalledTimes(1);
    });

    it('should upload a string as buffer', async () => {
      mocks.save.mockResolvedValue(undefined);
      mocks.getMetadata.mockResolvedValue([{ etag: '"def456"' }]);

      const result = await provider.upload('test/file.txt', 'hello world');

      expect(result.etag).toBe('"def456"');
      expect(mocks.save).toHaveBeenCalledTimes(1);
    });

    it('should upload a stream using createWriteStream', async () => {
      const passThrough = new Readable({ read() {} });
      mocks.createWriteStream.mockReturnValue(passThrough);
      mocks.getMetadata.mockResolvedValue([{ etag: '"stream123"' }]);

      // Mock the pipe chain — simulate the stream finishing
      let finishCallback: (() => void) | undefined;
      passThrough.on = rs.fn((event: string, cb: () => void) => {
        if (event === 'finish') {
          finishCallback = cb;
        }
        return passThrough;
      }) as typeof passThrough.on;

      const stream = createReadableStream('stream data');

      // Override pipe to simulate completion
      stream.pipe = rs.fn(() => {
        // Immediately fire finish
        setTimeout(() => finishCallback?.(), 0);
        return passThrough;
      }) as typeof stream.pipe;

      const result = await provider.upload('test/stream.txt', stream, {
        contentType: 'application/octet-stream',
      });

      expect(result.etag).toBe('"stream123"');
      expect(mocks.createWriteStream).toHaveBeenCalledTimes(1);
    });

    it('should propagate source stream errors during stream upload', async () => {
      const passThrough = new Readable({ read() {} });
      mocks.createWriteStream.mockReturnValue(passThrough);

      // Track error listeners on the source stream
      let sourceErrorCallback: ((err: Error) => void) | undefined;
      passThrough.on = rs.fn(
        (_event: string, _cb: (...args: unknown[]) => void) => {
          return passThrough;
        },
      ) as typeof passThrough.on;

      const stream = new Readable({ read() {} });

      // Capture the error listener registered on the source stream
      const originalOn = stream.on.bind(stream);
      stream.on = rs.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'error') {
          sourceErrorCallback = cb as (err: Error) => void;
        }
        return originalOn(event, cb);
      }) as typeof stream.on;

      stream.pipe = rs.fn(() => {
        // Don't finish — let the source error propagate
        return passThrough;
      }) as typeof stream.pipe;

      const uploadPromise = provider.upload('test/error-stream.txt', stream);

      // Simulate source stream error after upload starts
      await new Promise((r) => setTimeout(r, 10));
      if (sourceErrorCallback) {
        sourceErrorCallback(new Error('Source stream failed'));
      }

      await expect(uploadPromise).rejects.toThrow(StorageError);
    });

    it('should call onProgress for buffer uploads', async () => {
      mocks.save.mockResolvedValue(undefined);
      mocks.getMetadata.mockResolvedValue([{ etag: '"prog"' }]);
      const onProgress = rs.fn();

      const buffer = Buffer.from('progress data');
      await provider.upload('test/progress.txt', buffer, { onProgress });

      expect(onProgress).toHaveBeenCalledWith({
        loaded: buffer.length,
        total: buffer.length,
      });
    });

    it('should pass upload options', async () => {
      mocks.save.mockResolvedValue(undefined);
      mocks.getMetadata.mockResolvedValue([{ etag: '"opts"' }]);

      await provider.upload('test/opts.txt', Buffer.from('data'), {
        contentType: 'image/png',
        contentDisposition: 'attachment',
        cacheControl: 'max-age=3600',
        metadata: { custom: 'value' },
      });

      expect(mocks.save).toHaveBeenCalledTimes(1);
    });

    it('should throw StorageError on upload failure', async () => {
      mocks.save.mockRejectedValue(createGcsError(403));

      try {
        await provider.upload('test/fail.txt', Buffer.from('data'));
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(
          StorageErrorCode.ACCESS_DENIED,
        );
        expect((error as StorageError).provider).toBe('gcs');
      }
    });
  });

  describe('download', () => {
    it('should download an object as buffer', async () => {
      mocks.download.mockResolvedValue([Buffer.from('file content')]);
      mocks.getMetadata.mockResolvedValue([
        {
          contentType: 'text/plain',
          size: '12',
          etag: '"dl123"',
          updated: '2026-01-01T00:00:00Z',
          metadata: { key: 'val' },
        },
      ]);

      const result = await provider.download('test/file.txt');

      expect(result.body.toString()).toBe('file content');
      expect(result.contentType).toBe('text/plain');
      expect(result.contentLength).toBe(12);
      expect(result.etag).toBe('"dl123"');
      expect(result.lastModified).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(result.metadata).toEqual({ key: 'val' });
    });

    it('should download with range option', async () => {
      mocks.download.mockResolvedValue([Buffer.from('partial')]);
      mocks.getMetadata.mockResolvedValue([{ contentType: 'text/plain' }]);

      await provider.download('test/file.txt', {
        range: { start: 0, end: 100 },
      });

      expect(mocks.download).toHaveBeenCalledTimes(1);
    });

    it('should throw NOT_FOUND for missing object', async () => {
      mocks.download.mockRejectedValue(createGcsError(404));

      try {
        await provider.download('missing.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(StorageErrorCode.NOT_FOUND);
      }
    });
  });

  describe('downloadStream', () => {
    it('should return a readable stream', async () => {
      const bodyStream = createReadableStream('stream content');
      mocks.exists.mockResolvedValue([true]);
      mocks.createReadStream.mockReturnValue(bodyStream);

      const result = await provider.downloadStream('test/file.txt');

      expect(result).toBeInstanceOf(Readable);
    });

    it('should pass range option', async () => {
      const bodyStream = createReadableStream('partial');
      mocks.exists.mockResolvedValue([true]);
      mocks.createReadStream.mockReturnValue(bodyStream);

      await provider.downloadStream('test/file.txt', {
        range: { start: 10, end: 50 },
      });

      expect(mocks.createReadStream).toHaveBeenCalledTimes(1);
    });

    it('should throw NOT_FOUND when object does not exist', async () => {
      mocks.exists.mockResolvedValue([false]);

      try {
        await provider.downloadStream('missing.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(StorageErrorCode.NOT_FOUND);
      }
    });
  });

  describe('delete', () => {
    it('should delete an object', async () => {
      mocks.delete.mockResolvedValue([{}]);

      await provider.delete('test/file.txt');

      expect(mocks.delete).toHaveBeenCalledTimes(1);
    });

    it('should silently succeed when object does not exist', async () => {
      mocks.delete.mockRejectedValue(createGcsError(404));

      await expect(provider.delete('missing.txt')).resolves.toBeUndefined();
    });

    it('should throw on access denied', async () => {
      mocks.delete.mockRejectedValue(createGcsError(403));

      await expect(provider.delete('forbidden.txt')).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('list', () => {
    it('should list objects', async () => {
      mocks.getFiles.mockResolvedValue([
        [
          {
            name: 'a.txt',
            metadata: {
              size: '10',
              updated: '2026-01-01T00:00:00Z',
              etag: '"a"',
            },
          },
          {
            name: 'b.txt',
            metadata: {
              size: '20',
              updated: '2026-01-01T00:00:00Z',
              etag: '"b"',
            },
          },
        ],
        null,
        {},
      ]);

      const items: { key: string }[] = [];
      for await (const item of provider.list()) {
        items.push(item);
      }

      expect(items).toHaveLength(2);
      expect(items[0].key).toBe('a.txt');
      expect(items[1].key).toBe('b.txt');
    });

    it('should list with prefix', async () => {
      mocks.getFiles.mockResolvedValue([
        [
          {
            name: 'photos/cat.jpg',
            metadata: { size: '100' },
          },
        ],
        null,
        {},
      ]);

      const items: { key: string }[] = [];
      for await (const item of provider.list({
        prefix: 'photos/',
        delimiter: '/',
      })) {
        items.push(item);
      }

      expect(items).toHaveLength(1);
      expect(items[0].key).toBe('photos/cat.jpg');
    });

    it('should handle pagination', async () => {
      mocks.getFiles
        .mockResolvedValueOnce([
          [{ name: 'page1.txt', metadata: {} }],
          null,
          { nextPageToken: 'token1' },
        ])
        .mockResolvedValueOnce([
          [{ name: 'page2.txt', metadata: {} }],
          null,
          {},
        ]);

      const items: { key: string }[] = [];
      for await (const item of provider.list()) {
        items.push(item);
      }

      expect(items).toHaveLength(2);
      expect(mocks.getFiles).toHaveBeenCalledTimes(2);
    });

    it('should respect maxKeys limit across pages', async () => {
      mocks.getFiles.mockResolvedValueOnce([
        [
          { name: '1.txt', metadata: {} },
          { name: '2.txt', metadata: {} },
          { name: '3.txt', metadata: {} },
        ],
        null,
        { nextPageToken: 'token1' },
      ]);

      const items: { key: string }[] = [];
      for await (const item of provider.list({ maxKeys: 2 })) {
        items.push(item);
      }

      expect(items).toHaveLength(2);
      expect(items[0].key).toBe('1.txt');
      expect(items[1].key).toBe('2.txt');
      expect(mocks.getFiles).toHaveBeenCalledTimes(1);
    });

    it('should handle empty results', async () => {
      mocks.getFiles.mockResolvedValue([[], null, {}]);

      const items: { key: string }[] = [];
      for await (const item of provider.list()) {
        items.push(item);
      }

      expect(items).toHaveLength(0);
    });

    it('should throw on error', async () => {
      mocks.getFiles.mockRejectedValue(createGcsError(403));

      const items: { key: string }[] = [];
      try {
        for await (const item of provider.list()) {
          items.push(item);
        }
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(
          StorageErrorCode.ACCESS_DENIED,
        );
      }
    });
  });

  describe('copy', () => {
    it('should copy an object within the same bucket', async () => {
      mocks.copy.mockResolvedValue([{}, { resource: { etag: '"copy123"' } }]);

      const result = await provider.copy('source.txt', 'dest.txt');

      expect(result.etag).toBe('"copy123"');
      expect(mocks.copy).toHaveBeenCalledTimes(1);
    });

    it('should copy with metadata', async () => {
      mocks.copy.mockResolvedValue([{}, { resource: { etag: '"meta123"' } }]);

      const result = await provider.copy('source.txt', 'dest.txt', {
        metadata: { custom: 'new-value' },
      });

      expect(result.etag).toBe('"meta123"');
    });

    it('should throw on copy failure', async () => {
      mocks.copy.mockRejectedValue(createGcsError(404));

      await expect(provider.copy('missing.txt', 'dest.txt')).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('getMetadata', () => {
    it('should return object metadata', async () => {
      mocks.getMetadata.mockResolvedValue([
        {
          contentType: 'image/png',
          size: '5000',
          contentDisposition: 'inline',
          cacheControl: 'max-age=86400',
          etag: '"meta456"',
          updated: '2026-03-01T00:00:00Z',
          metadata: { author: 'test' },
        },
      ]);

      const metadata = await provider.getMetadata('photo.png');

      expect(metadata.contentType).toBe('image/png');
      expect(metadata.contentLength).toBe(5000);
      expect(metadata.contentDisposition).toBe('inline');
      expect(metadata.cacheControl).toBe('max-age=86400');
      expect(metadata.etag).toBe('"meta456"');
      expect(metadata.lastModified).toEqual(new Date('2026-03-01T00:00:00Z'));
      expect(metadata.metadata).toEqual({ author: 'test' });
    });

    it('should throw NOT_FOUND for missing object', async () => {
      mocks.getMetadata.mockRejectedValue(createGcsError(404));

      try {
        await provider.getMetadata('missing.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(StorageErrorCode.NOT_FOUND);
      }
    });
  });

  describe('getPresignedUrl', () => {
    it('should generate a GET presigned URL', async () => {
      mocks.getSignedUrl.mockResolvedValue([
        'https://storage.googleapis.com/bucket/file.txt?signed=true',
      ]);

      const url = await provider.getPresignedUrl('file.txt', {
        action: 'get',
        expiresInSeconds: 3600,
      });

      expect(url).toBe(
        'https://storage.googleapis.com/bucket/file.txt?signed=true',
      );
      expect(mocks.getSignedUrl).toHaveBeenCalledTimes(1);
    });

    it('should generate a PUT presigned URL with content type', async () => {
      mocks.getSignedUrl.mockResolvedValue([
        'https://storage.googleapis.com/bucket/upload.png?signed=true',
      ]);

      const url = await provider.getPresignedUrl('upload.png', {
        action: 'put',
        expiresInSeconds: 900,
        contentType: 'image/png',
      });

      expect(url).toContain('upload.png');
      expect(mocks.getSignedUrl).toHaveBeenCalledTimes(1);
    });

    it('should throw on presigned URL failure', async () => {
      mocks.getSignedUrl.mockRejectedValue(createGcsError(403));

      await expect(
        provider.getPresignedUrl('file.txt', {
          action: 'get',
          expiresInSeconds: 3600,
        }),
      ).rejects.toThrow(StorageError);
    });
  });

  describe('exists', () => {
    it('should return true when object exists', async () => {
      mocks.exists.mockResolvedValue([true]);

      const result = await provider.exists('file.txt');

      expect(result).toBe(true);
    });

    it('should return false when object does not exist', async () => {
      mocks.exists.mockResolvedValue([false]);

      const result = await provider.exists('missing.txt');

      expect(result).toBe(false);
    });

    it('should throw on access denied', async () => {
      mocks.exists.mockRejectedValue(createGcsError(403));

      await expect(provider.exists('forbidden.txt')).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('getNativeClient', () => {
    it('should return the Storage instance', () => {
      const client = provider.getNativeClient();
      expect(client).toBeDefined();
    });
  });

  describe('error mapping', () => {
    it('should map 404 to NOT_FOUND', async () => {
      mocks.download.mockRejectedValue(createGcsError(404));

      try {
        await provider.download('missing.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(StorageErrorCode.NOT_FOUND);
        expect((error as StorageError).httpStatus).toBe(404);
        expect((error as StorageError).provider).toBe('gcs');
      }
    });

    it('should map 403 to ACCESS_DENIED', async () => {
      mocks.download.mockRejectedValue(createGcsError(403));

      try {
        await provider.download('forbidden.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(
          StorageErrorCode.ACCESS_DENIED,
        );
        expect((error as StorageError).httpStatus).toBe(403);
      }
    });

    it('should map 409 to ALREADY_EXISTS', async () => {
      mocks.save.mockRejectedValue(createGcsError(409));

      try {
        await provider.upload('test.txt', Buffer.from('data'));
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(
          StorageErrorCode.ALREADY_EXISTS,
        );
      }
    });

    it('should map 412 to PRECONDITION_FAILED', async () => {
      mocks.download.mockRejectedValue(createGcsError(412));

      try {
        await provider.download('cond.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(
          StorageErrorCode.PRECONDITION_FAILED,
        );
      }
    });

    it('should map unknown errors to UNKNOWN', async () => {
      mocks.download.mockRejectedValue(createGcsError(500));

      try {
        await provider.download('error.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(StorageErrorCode.UNKNOWN);
        expect((error as StorageError).httpStatus).toBe(500);
      }
    });

    it('should preserve original error', async () => {
      const originalError = createGcsError(404);
      mocks.download.mockRejectedValue(originalError);

      try {
        await provider.download('missing.txt');
      } catch (error) {
        expect((error as StorageError).originalError).toBe(originalError);
      }
    });
  });
});
