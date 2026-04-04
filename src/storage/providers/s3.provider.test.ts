import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { Readable } from 'node:stream';
import { S3StorageProvider } from './s3.provider';
import type { S3ProviderConfig } from './s3.provider';
import { StorageError, StorageErrorCode } from '../storage-error';

const mocks = {
  send: rs.fn(),
  getSignedUrl: rs.fn(),
  uploadDone: rs.fn(),
  uploadOn: rs.fn(),
};

rs.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mocks.send;
    config = { region: 'us-east-1' };
  },
  GetObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  PutObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  DeleteObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  HeadObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
  ListObjectsV2Command: class {
    constructor(public input: Record<string, unknown>) {}
  },
  CopyObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

rs.mock('@aws-sdk/lib-storage', () => ({
  Upload: class {
    done = mocks.uploadDone;
    on = mocks.uploadOn;
    constructor(public params: Record<string, unknown>) {}
  },
}));

rs.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mocks.getSignedUrl(...args),
}));

function createReadableStream(data: string): Readable {
  return Readable.from([Buffer.from(data)]);
}

function createAwsError(name: string, statusCode: number): Error {
  const error = new Error(name);
  error.name = name;
  (error as unknown as Record<string, unknown>).$metadata = {
    httpStatusCode: statusCode,
  };
  return error;
}

describe('S3StorageProvider', () => {
  let provider: S3StorageProvider;
  const defaultConfig: S3ProviderConfig = {
    bucket: 'test-bucket',
    region: 'us-east-1',
  };

  beforeEach(() => {
    rs.clearAllMocks();
    provider = new S3StorageProvider(defaultConfig);
  });

  describe('constructor', () => {
    it('should create provider with minimal config', () => {
      const p = new S3StorageProvider({ bucket: 'my-bucket' });
      expect(p).toBeDefined();
    });

    it('should create provider with MinIO config', () => {
      const p = new S3StorageProvider({
        bucket: 'my-bucket',
        endpoint: 'http://localhost:9000',
        forcePathStyle: true,
        credentials: {
          accessKey: 'minioadmin',
          secretKey: 'minioadmin',
        },
      });
      expect(p).toBeDefined();
    });

    it('should create provider with AWS config', () => {
      const p = new S3StorageProvider({
        bucket: 'my-bucket',
        region: 'eu-west-1',
      });
      expect(p).toBeDefined();
    });
  });

  describe('upload', () => {
    it('should upload a buffer with PutObjectCommand', async () => {
      mocks.send.mockResolvedValue({
        ETag: '"abc123"',
        VersionId: 'v1',
      });

      const result = await provider.upload(
        'test/file.txt',
        Buffer.from('hello'),
        { contentType: 'text/plain' },
      );

      expect(result.etag).toBe('"abc123"');
      expect(result.versionId).toBe('v1');
      expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('should upload a string as buffer', async () => {
      mocks.send.mockResolvedValue({ ETag: '"def456"' });

      const result = await provider.upload('test/file.txt', 'hello world');

      expect(result.etag).toBe('"def456"');
      expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('should upload a stream using Upload class', async () => {
      mocks.uploadDone.mockResolvedValue({
        ETag: '"stream123"',
        VersionId: 'v2',
      });

      const stream = createReadableStream('stream data');
      const result = await provider.upload('test/stream.txt', stream, {
        contentType: 'application/octet-stream',
      });

      expect(result.etag).toBe('"stream123"');
      expect(result.versionId).toBe('v2');
      expect(mocks.uploadDone).toHaveBeenCalledTimes(1);
    });

    it('should attach progress handler for stream uploads', async () => {
      mocks.uploadDone.mockResolvedValue({ ETag: '"prog"' });
      const onProgress = rs.fn();

      const stream = createReadableStream('data');
      await provider.upload('test/progress.txt', stream, { onProgress });

      expect(mocks.uploadOn).toHaveBeenCalledWith(
        'httpUploadProgress',
        expect.any(Function),
      );
    });

    it('should pass upload options to PutObjectCommand', async () => {
      mocks.send.mockResolvedValue({ ETag: '"opts"' });

      await provider.upload('test/opts.txt', Buffer.from('data'), {
        contentType: 'image/png',
        contentDisposition: 'attachment',
        cacheControl: 'max-age=3600',
        metadata: { custom: 'value' },
      });

      expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('should throw StorageError on upload failure', async () => {
      mocks.send.mockRejectedValue(createAwsError('AccessDenied', 403));

      await expect(
        provider.upload('test/fail.txt', Buffer.from('data')),
      ).rejects.toThrow(StorageError);

      try {
        await provider.upload('test/fail.txt', Buffer.from('data'));
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(
          StorageErrorCode.ACCESS_DENIED,
        );
        expect((error as StorageError).provider).toBe('s3');
      }
    });
  });

  describe('download', () => {
    it('should download an object as buffer', async () => {
      const bodyStream = createReadableStream('file content');
      mocks.send.mockResolvedValue({
        Body: bodyStream,
        ContentType: 'text/plain',
        ContentLength: 12,
        ETag: '"dl123"',
        LastModified: new Date('2026-01-01'),
        Metadata: { key: 'val' },
      });

      const result = await provider.download('test/file.txt');

      expect(result.body.toString()).toBe('file content');
      expect(result.contentType).toBe('text/plain');
      expect(result.contentLength).toBe(12);
      expect(result.etag).toBe('"dl123"');
      expect(result.lastModified).toEqual(new Date('2026-01-01'));
      expect(result.metadata).toEqual({ key: 'val' });
    });

    it('should download with range option', async () => {
      const bodyStream = createReadableStream('partial');
      mocks.send.mockResolvedValue({
        Body: bodyStream,
        ContentType: 'text/plain',
      });

      await provider.download('test/file.txt', {
        range: { start: 0, end: 100 },
      });

      expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('should throw NOT_FOUND for missing object', async () => {
      mocks.send.mockRejectedValue(createAwsError('NoSuchKey', 404));

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
      mocks.send.mockResolvedValue({ Body: bodyStream });

      const result = await provider.downloadStream('test/file.txt');

      expect(result).toBeInstanceOf(Readable);
    });

    it('should pass range option', async () => {
      const bodyStream = createReadableStream('partial');
      mocks.send.mockResolvedValue({ Body: bodyStream });

      await provider.downloadStream('test/file.txt', {
        range: { start: 10, end: 50 },
      });

      expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('should throw on error', async () => {
      mocks.send.mockRejectedValue(createAwsError('NoSuchKey', 404));

      await expect(provider.downloadStream('missing.txt')).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('delete', () => {
    it('should delete an object', async () => {
      mocks.send.mockResolvedValue({});

      await provider.delete('test/file.txt');

      expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('should silently succeed when object does not exist', async () => {
      mocks.send.mockRejectedValue(createAwsError('NoSuchKey', 404));

      await expect(provider.delete('missing.txt')).resolves.toBeUndefined();
    });

    it('should throw on access denied', async () => {
      mocks.send.mockRejectedValue(createAwsError('AccessDenied', 403));

      await expect(provider.delete('forbidden.txt')).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('list', () => {
    it('should list objects', async () => {
      mocks.send.mockResolvedValue({
        Contents: [
          { Key: 'a.txt', Size: 10, LastModified: new Date(), ETag: '"a"' },
          { Key: 'b.txt', Size: 20, LastModified: new Date(), ETag: '"b"' },
        ],
        IsTruncated: false,
      });

      const items: { key: string }[] = [];
      for await (const item of provider.list()) {
        items.push(item);
      }

      expect(items).toHaveLength(2);
      expect(items[0].key).toBe('a.txt');
      expect(items[1].key).toBe('b.txt');
    });

    it('should list with prefix and delimiter', async () => {
      mocks.send.mockResolvedValue({
        Contents: [{ Key: 'photos/cat.jpg', Size: 100 }],
        IsTruncated: false,
      });

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
      mocks.send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'page1.txt' }],
          IsTruncated: true,
          NextContinuationToken: 'token1',
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: 'page2.txt' }],
          IsTruncated: false,
        });

      const items: { key: string }[] = [];
      for await (const item of provider.list()) {
        items.push(item);
      }

      expect(items).toHaveLength(2);
      expect(mocks.send).toHaveBeenCalledTimes(2);
    });

    it('should respect maxKeys limit across pages', async () => {
      mocks.send
        .mockResolvedValueOnce({
          Contents: [{ Key: '1.txt' }, { Key: '2.txt' }, { Key: '3.txt' }],
          IsTruncated: true,
          NextContinuationToken: 'token1',
        })
        .mockResolvedValueOnce({
          Contents: [{ Key: '4.txt' }],
          IsTruncated: false,
        });

      const items: { key: string }[] = [];
      for await (const item of provider.list({ maxKeys: 2 })) {
        items.push(item);
      }

      expect(items).toHaveLength(2);
      expect(items[0].key).toBe('1.txt');
      expect(items[1].key).toBe('2.txt');
      expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('should handle empty results', async () => {
      mocks.send.mockReset();
      mocks.send.mockResolvedValue({
        Contents: undefined,
        IsTruncated: false,
      });

      const items: { key: string }[] = [];
      for await (const item of provider.list()) {
        items.push(item);
      }

      expect(items).toHaveLength(0);
    });

    it('should throw on error', async () => {
      mocks.send.mockRejectedValue(createAwsError('AccessDenied', 403));

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
      mocks.send.mockResolvedValue({
        CopyObjectResult: { ETag: '"copy123"' },
      });

      const result = await provider.copy('source.txt', 'dest.txt');

      expect(result.etag).toBe('"copy123"');
      expect(mocks.send).toHaveBeenCalledTimes(1);
    });

    it('should copy with metadata replacement', async () => {
      mocks.send.mockResolvedValue({
        CopyObjectResult: { ETag: '"meta123"' },
      });

      const result = await provider.copy('source.txt', 'dest.txt', {
        metadata: { custom: 'new-value' },
      });

      expect(result.etag).toBe('"meta123"');
    });

    it('should throw on copy failure', async () => {
      mocks.send.mockRejectedValue(createAwsError('NoSuchKey', 404));

      await expect(provider.copy('missing.txt', 'dest.txt')).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('getMetadata', () => {
    it('should return object metadata', async () => {
      mocks.send.mockResolvedValue({
        ContentType: 'image/png',
        ContentLength: 5000,
        ContentDisposition: 'inline',
        CacheControl: 'max-age=86400',
        ETag: '"meta456"',
        LastModified: new Date('2026-03-01'),
        Metadata: { author: 'test' },
      });

      const metadata = await provider.getMetadata('photo.png');

      expect(metadata.contentType).toBe('image/png');
      expect(metadata.contentLength).toBe(5000);
      expect(metadata.contentDisposition).toBe('inline');
      expect(metadata.cacheControl).toBe('max-age=86400');
      expect(metadata.etag).toBe('"meta456"');
      expect(metadata.lastModified).toEqual(new Date('2026-03-01'));
      expect(metadata.metadata).toEqual({ author: 'test' });
    });

    it('should throw NOT_FOUND for missing object', async () => {
      mocks.send.mockRejectedValue(createAwsError('NotFound', 404));

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
      mocks.getSignedUrl.mockResolvedValue(
        'https://bucket.s3.amazonaws.com/file.txt?signed=true',
      );

      const url = await provider.getPresignedUrl('file.txt', {
        action: 'get',
        expiresInSeconds: 3600,
      });

      expect(url).toBe('https://bucket.s3.amazonaws.com/file.txt?signed=true');
      expect(mocks.getSignedUrl).toHaveBeenCalledTimes(1);
    });

    it('should generate a PUT presigned URL with content type', async () => {
      mocks.getSignedUrl.mockResolvedValue(
        'https://bucket.s3.amazonaws.com/upload.png?signed=true',
      );

      const url = await provider.getPresignedUrl('upload.png', {
        action: 'put',
        expiresInSeconds: 900,
        contentType: 'image/png',
      });

      expect(url).toContain('upload.png');
      expect(mocks.getSignedUrl).toHaveBeenCalledTimes(1);
    });

    it('should throw on presigned URL failure', async () => {
      mocks.getSignedUrl.mockRejectedValue(createAwsError('AccessDenied', 403));

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
      mocks.send.mockResolvedValue({ ContentLength: 100 });

      const result = await provider.exists('file.txt');

      expect(result).toBe(true);
    });

    it('should return false when object does not exist', async () => {
      mocks.send.mockRejectedValue(createAwsError('NotFound', 404));

      const result = await provider.exists('missing.txt');

      expect(result).toBe(false);
    });

    it('should throw on access denied', async () => {
      mocks.send.mockRejectedValue(createAwsError('AccessDenied', 403));

      await expect(provider.exists('forbidden.txt')).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('getNativeClient', () => {
    it('should return the S3Client instance', () => {
      const client = provider.getNativeClient();
      expect(client).toBeDefined();
    });
  });

  describe('error mapping', () => {
    it('should map NoSuchKey to NOT_FOUND', async () => {
      mocks.send.mockRejectedValue(createAwsError('NoSuchKey', 404));

      try {
        await provider.download('missing.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(StorageErrorCode.NOT_FOUND);
        expect((error as StorageError).httpStatus).toBe(404);
        expect((error as StorageError).provider).toBe('s3');
      }
    });

    it('should map AccessDenied to ACCESS_DENIED', async () => {
      mocks.send.mockRejectedValue(createAwsError('AccessDenied', 403));

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

    it('should map BucketAlreadyExists to ALREADY_EXISTS', async () => {
      mocks.send.mockRejectedValue(createAwsError('BucketAlreadyExists', 409));

      try {
        await provider.upload('test.txt', Buffer.from('data'));
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(
          StorageErrorCode.ALREADY_EXISTS,
        );
      }
    });

    it('should map PreconditionFailed to PRECONDITION_FAILED', async () => {
      mocks.send.mockRejectedValue(createAwsError('PreconditionFailed', 412));

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
      mocks.send.mockRejectedValue(createAwsError('InternalServerError', 500));

      try {
        await provider.download('error.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(StorageErrorCode.UNKNOWN);
        expect((error as StorageError).httpStatus).toBe(500);
      }
    });

    it('should preserve original error', async () => {
      const originalError = createAwsError('NoSuchKey', 404);
      mocks.send.mockRejectedValue(originalError);

      try {
        await provider.download('missing.txt');
      } catch (error) {
        expect((error as StorageError).originalError).toBe(originalError);
      }
    });
  });
});
