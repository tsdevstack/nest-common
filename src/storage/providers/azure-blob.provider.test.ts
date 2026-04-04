import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { Readable } from 'node:stream';
import { AzureBlobStorageProvider } from './azure-blob.provider';
import type { AzureBlobProviderConfig } from './azure-blob.provider';
import { StorageError, StorageErrorCode } from '../storage-error';

const mocks = {
  uploadData: rs.fn(),
  uploadStream: rs.fn(),
  download: rs.fn(),
  delete: rs.fn(),
  exists: rs.fn(),
  getProperties: rs.fn(),
  beginCopyFromURL: rs.fn(),
  getUserDelegationKey: rs.fn(),
  listBlobsFlat: rs.fn(),
  listBlobsByHierarchy: rs.fn(),
};

function createMockBlobClient(url: string): Record<string, unknown> {
  return {
    url,
    download: mocks.download,
    delete: mocks.delete,
    exists: mocks.exists,
    getProperties: mocks.getProperties,
    beginCopyFromURL: mocks.beginCopyFromURL,
  };
}

function createMockBlockBlobClient(): Record<string, unknown> {
  return {
    uploadData: mocks.uploadData,
    uploadStream: mocks.uploadStream,
  };
}

rs.mock('@azure/storage-blob', () => {
  class MockBlobServiceClient {
    getUserDelegationKey = mocks.getUserDelegationKey;
    getContainerClient = (): Record<string, unknown> => ({
      containerName: 'test-bucket',
      getBlobClient: (name: string) =>
        createMockBlobClient(
          `https://testaccount.blob.core.windows.net/test-bucket/${name}`,
        ),
      getBlockBlobClient: () => createMockBlockBlobClient(),
      listBlobsFlat: mocks.listBlobsFlat,
      listBlobsByHierarchy: mocks.listBlobsByHierarchy,
    });

    static fromConnectionString(): MockBlobServiceClient {
      return new MockBlobServiceClient();
    }
  }

  return {
    BlobServiceClient: MockBlobServiceClient,
    BlobSASPermissions: class {
      read = false;
      write = false;
      create = false;
    },
    generateBlobSASQueryParameters: () => 'sas-token',
    StorageSharedKeyCredential: class {
      constructor() {}
    },
    SASProtocol: { Https: 'https' },
  };
});

rs.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {},
}));

function createReadableStream(data: string): Readable {
  return Readable.from([Buffer.from(data)]);
}

function createAzureError(statusCode: number, errorCode: string): Error {
  const error = new Error(`Azure error: ${errorCode}`);
  (error as unknown as Record<string, unknown>).statusCode = statusCode;
  (error as unknown as Record<string, unknown>).details = { errorCode };
  return error;
}

describe('AzureBlobStorageProvider', () => {
  let provider: AzureBlobStorageProvider;
  const defaultConfig: AzureBlobProviderConfig = {
    bucket: 'test-bucket',
    accountName: 'testaccount',
    connectionString:
      'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net',
  };

  beforeEach(() => {
    rs.clearAllMocks();
    provider = new AzureBlobStorageProvider(defaultConfig);
  });

  describe('constructor', () => {
    it('should create provider with connection string', () => {
      const p = new AzureBlobStorageProvider({
        bucket: 'my-bucket',
        accountName: 'myaccount',
        connectionString:
          'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net',
      });
      expect(p).toBeDefined();
    });

    it('should create provider with DefaultAzureCredential', () => {
      const p = new AzureBlobStorageProvider({
        bucket: 'my-bucket',
        accountName: 'myaccount',
      });
      expect(p).toBeDefined();
    });
  });

  describe('upload', () => {
    it('should upload a buffer with uploadData', async () => {
      mocks.uploadData.mockResolvedValue({ etag: '"abc123"' });

      const result = await provider.upload(
        'test/file.txt',
        Buffer.from('hello'),
        { contentType: 'text/plain' },
      );

      expect(result.etag).toBe('"abc123"');
      expect(mocks.uploadData).toHaveBeenCalledTimes(1);
    });

    it('should upload a string as buffer', async () => {
      mocks.uploadData.mockResolvedValue({ etag: '"def456"' });

      const result = await provider.upload('test/file.txt', 'hello world');

      expect(result.etag).toBe('"def456"');
      expect(mocks.uploadData).toHaveBeenCalledTimes(1);
    });

    it('should upload a stream using uploadStream', async () => {
      mocks.uploadStream.mockResolvedValue({ etag: '"stream123"' });

      const stream = createReadableStream('stream data');
      const result = await provider.upload('test/stream.txt', stream, {
        contentType: 'application/octet-stream',
      });

      expect(result.etag).toBe('"stream123"');
      expect(mocks.uploadStream).toHaveBeenCalledTimes(1);
    });

    it('should pass onProgress for stream uploads', async () => {
      mocks.uploadStream.mockImplementation(
        async (
          _stream: Readable,
          _bufferSize: unknown,
          _maxConcurrency: unknown,
          opts: Record<string, unknown>,
        ) => {
          const onProgress = opts.onProgress as (progress: {
            loadedBytes: number;
          }) => void;
          if (onProgress) {
            onProgress({ loadedBytes: 100 });
            onProgress({ loadedBytes: 200 });
          }
          return { etag: '"streamprog"' };
        },
      );
      const onProgress = rs.fn();

      const stream = createReadableStream('stream data');
      await provider.upload('test/stream.txt', stream, { onProgress });

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith({ loaded: 100 });
      expect(onProgress).toHaveBeenCalledWith({ loaded: 200 });
    });

    it('should call onProgress for buffer uploads', async () => {
      mocks.uploadData.mockResolvedValue({ etag: '"prog"' });
      const onProgress = rs.fn();

      const buffer = Buffer.from('progress data');
      await provider.upload('test/progress.txt', buffer, { onProgress });

      expect(onProgress).toHaveBeenCalledWith({
        loaded: buffer.length,
        total: buffer.length,
      });
    });

    it('should pass upload options', async () => {
      mocks.uploadData.mockResolvedValue({ etag: '"opts"' });

      await provider.upload('test/opts.txt', Buffer.from('data'), {
        contentType: 'image/png',
        contentDisposition: 'attachment',
        cacheControl: 'max-age=3600',
        metadata: { custom: 'value' },
      });

      expect(mocks.uploadData).toHaveBeenCalledTimes(1);
    });

    it('should throw StorageError on upload failure', async () => {
      mocks.uploadData.mockRejectedValue(
        createAzureError(403, 'AuthorizationFailure'),
      );

      try {
        await provider.upload('test/fail.txt', Buffer.from('data'));
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(
          StorageErrorCode.ACCESS_DENIED,
        );
        expect((error as StorageError).provider).toBe('azure-blob');
      }
    });
  });

  describe('download', () => {
    it('should download an object as buffer', async () => {
      const bodyStream = createReadableStream('file content');
      mocks.download.mockResolvedValue({
        readableStreamBody: bodyStream,
        contentType: 'text/plain',
        contentLength: 12,
        etag: '"dl123"',
        lastModified: new Date('2026-01-01'),
        metadata: { key: 'val' },
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
      mocks.download.mockResolvedValue({
        readableStreamBody: bodyStream,
        contentType: 'text/plain',
      });

      await provider.download('test/file.txt', {
        range: { start: 0, end: 100 },
      });

      expect(mocks.download).toHaveBeenCalledTimes(1);
    });

    it('should throw NOT_FOUND for missing object', async () => {
      mocks.download.mockRejectedValue(createAzureError(404, 'BlobNotFound'));

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
      mocks.download.mockResolvedValue({
        readableStreamBody: bodyStream,
      });

      const result = await provider.downloadStream('test/file.txt');

      expect(result).toBeDefined();
    });

    it('should pass range option', async () => {
      const bodyStream = createReadableStream('partial');
      mocks.download.mockResolvedValue({
        readableStreamBody: bodyStream,
      });

      await provider.downloadStream('test/file.txt', {
        range: { start: 10, end: 50 },
      });

      expect(mocks.download).toHaveBeenCalledTimes(1);
    });

    it('should throw on error', async () => {
      mocks.download.mockRejectedValue(createAzureError(404, 'BlobNotFound'));

      await expect(provider.downloadStream('missing.txt')).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('delete', () => {
    it('should delete an object', async () => {
      mocks.delete.mockResolvedValue({});

      await provider.delete('test/file.txt');

      expect(mocks.delete).toHaveBeenCalledTimes(1);
    });

    it('should silently succeed when object does not exist', async () => {
      mocks.delete.mockRejectedValue(createAzureError(404, 'BlobNotFound'));

      await expect(provider.delete('missing.txt')).resolves.toBeUndefined();
    });

    it('should throw on access denied', async () => {
      mocks.delete.mockRejectedValue(
        createAzureError(403, 'AuthorizationFailure'),
      );

      await expect(provider.delete('forbidden.txt')).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('list', () => {
    it('should list objects', async () => {
      const items = [
        {
          name: 'a.txt',
          properties: {
            contentLength: 10,
            lastModified: new Date(),
            etag: '"a"',
          },
        },
        {
          name: 'b.txt',
          properties: {
            contentLength: 20,
            lastModified: new Date(),
            etag: '"b"',
          },
        },
      ];

      mocks.listBlobsFlat.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const item of items) {
            yield item;
          }
        },
      });

      const result: { key: string }[] = [];
      for await (const item of provider.list()) {
        result.push(item);
      }

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('a.txt');
      expect(result[1].key).toBe('b.txt');
    });

    it('should list with prefix', async () => {
      const items = [
        {
          name: 'photos/cat.jpg',
          properties: { contentLength: 100 },
        },
      ];

      mocks.listBlobsFlat.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const item of items) {
            yield item;
          }
        },
      });

      const result: { key: string }[] = [];
      for await (const item of provider.list({ prefix: 'photos/' })) {
        result.push(item);
      }

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('photos/cat.jpg');
    });

    it('should list with delimiter using listBlobsByHierarchy', async () => {
      const items = [
        {
          kind: 'prefix',
          name: 'photos/',
        },
        {
          kind: 'blob',
          name: 'readme.txt',
          properties: { contentLength: 50, etag: '"r"' },
        },
      ];

      mocks.listBlobsByHierarchy.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const item of items) {
            yield item;
          }
        },
      });

      const result: { key: string }[] = [];
      for await (const item of provider.list({
        prefix: '',
        delimiter: '/',
      })) {
        result.push(item);
      }

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('readme.txt');
      expect(mocks.listBlobsByHierarchy).toHaveBeenCalledTimes(1);
      expect(mocks.listBlobsFlat).not.toHaveBeenCalled();
    });

    it('should respect maxKeys limit', async () => {
      const items = [
        { name: '1.txt', properties: { contentLength: 10 } },
        { name: '2.txt', properties: { contentLength: 20 } },
        { name: '3.txt', properties: { contentLength: 30 } },
      ];

      mocks.listBlobsFlat.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const item of items) {
            yield item;
          }
        },
      });

      const result: { key: string }[] = [];
      for await (const item of provider.list({ maxKeys: 2 })) {
        result.push(item);
      }

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('1.txt');
      expect(result[1].key).toBe('2.txt');
    });

    it('should handle empty results', async () => {
      const emptyItems: unknown[] = [];
      mocks.listBlobsFlat.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield* emptyItems;
        },
      });

      const result: { key: string }[] = [];
      for await (const item of provider.list()) {
        result.push(item);
      }

      expect(result).toHaveLength(0);
    });

    it('should throw on error', async () => {
      mocks.listBlobsFlat.mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield* []; // satisfy linter
          throw createAzureError(403, 'AuthorizationFailure');
        },
      });

      const result: { key: string }[] = [];
      try {
        for await (const item of provider.list()) {
          result.push(item);
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
      mocks.beginCopyFromURL.mockResolvedValue({
        pollUntilDone: rs.fn().mockResolvedValue({ etag: '"copy123"' }),
      });

      const result = await provider.copy('source.txt', 'dest.txt');

      expect(result.etag).toBe('"copy123"');
    });

    it('should copy with metadata', async () => {
      mocks.beginCopyFromURL.mockResolvedValue({
        pollUntilDone: rs.fn().mockResolvedValue({ etag: '"meta123"' }),
      });

      const result = await provider.copy('source.txt', 'dest.txt', {
        metadata: { custom: 'new-value' },
      });

      expect(result.etag).toBe('"meta123"');
    });

    it('should throw on copy failure', async () => {
      mocks.beginCopyFromURL.mockRejectedValue(
        createAzureError(404, 'BlobNotFound'),
      );

      await expect(provider.copy('missing.txt', 'dest.txt')).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('getMetadata', () => {
    it('should return object metadata', async () => {
      mocks.getProperties.mockResolvedValue({
        contentType: 'image/png',
        contentLength: 5000,
        contentDisposition: 'inline',
        cacheControl: 'max-age=86400',
        etag: '"meta456"',
        lastModified: new Date('2026-03-01'),
        metadata: { author: 'test' },
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
      mocks.getProperties.mockRejectedValue(
        createAzureError(404, 'BlobNotFound'),
      );

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
      mocks.getUserDelegationKey.mockResolvedValue({
        signedObjectId: 'test',
        signedTenantId: 'test',
        signedStartsOn: new Date(),
        signedExpiresOn: new Date(),
        signedService: 'b',
        signedVersion: '2020-02-10',
      });

      const url = await provider.getPresignedUrl('file.txt', {
        action: 'get',
        expiresInSeconds: 3600,
      });

      expect(url).toContain('file.txt');
      expect(url).toContain('sas-token');
      expect(mocks.getUserDelegationKey).toHaveBeenCalledTimes(1);
    });

    it('should generate a PUT presigned URL', async () => {
      mocks.getUserDelegationKey.mockResolvedValue({
        signedObjectId: 'test',
        signedTenantId: 'test',
        signedStartsOn: new Date(),
        signedExpiresOn: new Date(),
        signedService: 'b',
        signedVersion: '2020-02-10',
      });

      const url = await provider.getPresignedUrl('upload.png', {
        action: 'put',
        expiresInSeconds: 900,
        contentType: 'image/png',
      });

      expect(url).toContain('upload.png');
      expect(url).toContain('sas-token');
    });

    it('should throw on presigned URL failure', async () => {
      mocks.getUserDelegationKey.mockRejectedValue(
        createAzureError(403, 'AuthorizationFailure'),
      );

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
      mocks.exists.mockResolvedValue(true);

      const result = await provider.exists('file.txt');

      expect(result).toBe(true);
    });

    it('should return false when object does not exist', async () => {
      mocks.exists.mockResolvedValue(false);

      const result = await provider.exists('missing.txt');

      expect(result).toBe(false);
    });

    it('should throw on access denied', async () => {
      mocks.exists.mockRejectedValue(
        createAzureError(403, 'AuthorizationFailure'),
      );

      await expect(provider.exists('forbidden.txt')).rejects.toThrow(
        StorageError,
      );
    });
  });

  describe('getNativeClient', () => {
    it('should return the BlobServiceClient instance', () => {
      const client = provider.getNativeClient();
      expect(client).toBeDefined();
    });
  });

  describe('error mapping', () => {
    it('should map BlobNotFound to NOT_FOUND', async () => {
      mocks.download.mockRejectedValue(createAzureError(404, 'BlobNotFound'));

      try {
        await provider.download('missing.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(StorageErrorCode.NOT_FOUND);
        expect((error as StorageError).httpStatus).toBe(404);
        expect((error as StorageError).provider).toBe('azure-blob');
      }
    });

    it('should map ContainerNotFound to NOT_FOUND', async () => {
      mocks.download.mockRejectedValue(
        createAzureError(404, 'ContainerNotFound'),
      );

      try {
        await provider.download('missing.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(StorageErrorCode.NOT_FOUND);
      }
    });

    it('should map AuthorizationFailure to ACCESS_DENIED', async () => {
      mocks.download.mockRejectedValue(
        createAzureError(403, 'AuthorizationFailure'),
      );

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

    it('should map AuthorizationPermissionMismatch to ACCESS_DENIED', async () => {
      mocks.download.mockRejectedValue(
        createAzureError(403, 'AuthorizationPermissionMismatch'),
      );

      try {
        await provider.download('forbidden.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(
          StorageErrorCode.ACCESS_DENIED,
        );
      }
    });

    it('should map BlobAlreadyExists to ALREADY_EXISTS', async () => {
      mocks.uploadData.mockRejectedValue(
        createAzureError(409, 'BlobAlreadyExists'),
      );

      try {
        await provider.upload('test.txt', Buffer.from('data'));
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(
          StorageErrorCode.ALREADY_EXISTS,
        );
      }
    });

    it('should map ConditionNotMet to PRECONDITION_FAILED', async () => {
      mocks.download.mockRejectedValue(
        createAzureError(412, 'ConditionNotMet'),
      );

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
      mocks.download.mockRejectedValue(createAzureError(500, 'InternalError'));

      try {
        await provider.download('error.txt');
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError);
        expect((error as StorageError).code).toBe(StorageErrorCode.UNKNOWN);
        expect((error as StorageError).httpStatus).toBe(500);
      }
    });

    it('should preserve original error', async () => {
      const originalError = createAzureError(404, 'BlobNotFound');
      mocks.download.mockRejectedValue(originalError);

      try {
        await provider.download('missing.txt');
      } catch (error) {
        expect((error as StorageError).originalError).toBe(originalError);
      }
    });
  });
});
