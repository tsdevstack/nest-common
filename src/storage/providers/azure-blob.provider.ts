import { Readable } from 'node:stream';
import {
  BlobServiceClient,
  ContainerClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  SASProtocol,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { BlobDownloadResponseParsed } from '@azure/storage-blob';
import { StorageError, StorageErrorCode } from '../storage-error';
import type {
  StorageProvider,
  UploadOptions,
  UploadResult,
  DownloadOptions,
  DownloadResult,
  ListOptions,
  ObjectInfo,
  ObjectMetadata,
  PresignedUrlOptions,
  CopyOptions,
  CopyResult,
} from '../storage.interface';

export interface AzureBlobProviderConfig {
  bucket: string;
  accountName: string;
  connectionString?: string;
}

export class AzureBlobStorageProvider implements StorageProvider {
  private readonly serviceClient: BlobServiceClient;
  private readonly containerClient: ContainerClient;

  constructor(private readonly config: AzureBlobProviderConfig) {
    if (config.connectionString) {
      this.serviceClient = BlobServiceClient.fromConnectionString(
        config.connectionString,
      );
    } else {
      const url = `https://${config.accountName}.blob.core.windows.net`;
      this.serviceClient = new BlobServiceClient(
        url,
        new DefaultAzureCredential(),
      );
    }

    this.containerClient = this.serviceClient.getContainerClient(config.bucket);
  }

  async upload(
    key: string,
    body: Buffer | Readable | string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    try {
      const blockBlobClient = this.containerClient.getBlockBlobClient(key);
      const blobOptions: Record<string, unknown> = {};
      const blobHttpHeaders: Record<string, string> = {};

      if (options?.contentType) {
        blobHttpHeaders.blobContentType = options.contentType;
      }
      if (options?.contentDisposition) {
        blobHttpHeaders.blobContentDisposition = options.contentDisposition;
      }
      if (options?.cacheControl) {
        blobHttpHeaders.blobCacheControl = options.cacheControl;
      }

      if (Object.keys(blobHttpHeaders).length > 0) {
        blobOptions.blobHTTPHeaders = blobHttpHeaders;
      }
      if (options?.metadata) {
        blobOptions.metadata = options.metadata;
      }

      if (body instanceof Readable) {
        if (options?.onProgress) {
          const userOnProgress = options.onProgress;
          blobOptions.onProgress = (progress: { loadedBytes: number }) => {
            userOnProgress({ loaded: progress.loadedBytes });
          };
        }

        const result = await blockBlobClient.uploadStream(
          body,
          undefined,
          undefined,
          blobOptions,
        );

        return {
          etag: result.etag,
        };
      }

      const buffer = typeof body === 'string' ? Buffer.from(body) : body;
      const result = await blockBlobClient.uploadData(buffer, blobOptions);

      if (options?.onProgress) {
        options.onProgress({
          loaded: buffer.length,
          total: buffer.length,
        });
      }

      return {
        etag: result.etag,
      };
    } catch (error) {
      throw this.mapError(error, `Failed to upload object: ${key}`);
    }
  }

  async download(
    key: string,
    options?: DownloadOptions,
  ): Promise<DownloadResult> {
    try {
      const blobClient = this.containerClient.getBlobClient(key);

      const response: BlobDownloadResponseParsed = await blobClient.download(
        options?.range?.start,
        options?.range
          ? options.range.end - options.range.start + 1
          : undefined,
      );

      const readableStream = response.readableStreamBody;
      if (!readableStream) {
        throw new Error('No readable stream in response');
      }

      const chunks: Buffer[] = [];
      for await (const chunk of readableStream as AsyncIterable<Buffer>) {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array),
        );
      }

      return {
        body: Buffer.concat(chunks),
        contentType: response.contentType,
        contentLength: response.contentLength,
        etag: response.etag,
        lastModified: response.lastModified,
        metadata: response.metadata,
      };
    } catch (error) {
      throw this.mapError(error, `Failed to download object: ${key}`);
    }
  }

  async downloadStream(
    key: string,
    options?: DownloadOptions,
  ): Promise<Readable> {
    try {
      const blobClient = this.containerClient.getBlobClient(key);
      const response = await blobClient.download(
        options?.range?.start,
        options?.range
          ? options.range.end - options.range.start + 1
          : undefined,
      );

      const readableStream = response.readableStreamBody;
      if (!readableStream) {
        throw new Error('No readable stream in response');
      }

      return readableStream as unknown as Readable;
    } catch (error) {
      throw this.mapError(error, `Failed to download stream: ${key}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.containerClient.getBlobClient(key).delete();
    } catch (error) {
      const mapped = this.mapError(error, `Failed to delete object: ${key}`);
      if (mapped.code === StorageErrorCode.NOT_FOUND) {
        return;
      }
      throw mapped;
    }
  }

  async *list(options?: ListOptions): AsyncIterable<ObjectInfo> {
    let yielded = 0;
    const maxKeys = options?.maxKeys;

    try {
      const listOptions: Record<string, string> = {};
      if (options?.prefix) {
        listOptions.prefix = options.prefix;
      }

      if (options?.delimiter) {
        const iter = this.containerClient.listBlobsByHierarchy(
          options.delimiter,
          listOptions,
        );

        for await (const item of iter) {
          if (item.kind === 'prefix') {
            continue;
          }
          if (maxKeys !== undefined && yielded >= maxKeys) {
            return;
          }
          yield {
            key: item.name,
            size: item.properties.contentLength,
            lastModified: item.properties.lastModified,
            etag: item.properties.etag,
          };
          yielded++;
        }
      } else {
        const iter = this.containerClient.listBlobsFlat(listOptions);

        for await (const blob of iter) {
          if (maxKeys !== undefined && yielded >= maxKeys) {
            return;
          }
          yield {
            key: blob.name,
            size: blob.properties.contentLength,
            lastModified: blob.properties.lastModified,
            etag: blob.properties.etag,
          };
          yielded++;
        }
      }
    } catch (error) {
      throw this.mapError(error, 'Failed to list objects');
    }
  }

  async copy(
    sourceKey: string,
    destinationKey: string,
    options?: CopyOptions,
  ): Promise<CopyResult> {
    try {
      const sourceBlob = this.containerClient.getBlobClient(sourceKey);
      const destBlob = this.containerClient.getBlobClient(destinationKey);

      const copyOptions: Record<string, unknown> = {};
      if (options?.metadata) {
        copyOptions.metadata = options.metadata;
      }

      const poller = await destBlob.beginCopyFromURL(
        sourceBlob.url,
        copyOptions,
      );
      const result = await poller.pollUntilDone();

      return {
        etag: result.etag,
      };
    } catch (error) {
      throw this.mapError(
        error,
        `Failed to copy object: ${sourceKey} → ${destinationKey}`,
      );
    }
  }

  async getMetadata(key: string): Promise<ObjectMetadata> {
    try {
      const blobClient = this.containerClient.getBlobClient(key);
      const properties = await blobClient.getProperties();

      return {
        contentType: properties.contentType,
        contentLength: properties.contentLength,
        contentDisposition: properties.contentDisposition,
        cacheControl: properties.cacheControl,
        etag: properties.etag,
        lastModified: properties.lastModified,
        metadata: properties.metadata,
      };
    } catch (error) {
      throw this.mapError(error, `Failed to get metadata: ${key}`);
    }
  }

  async getPresignedUrl(
    key: string,
    options: PresignedUrlOptions,
  ): Promise<string> {
    try {
      const blobClient = this.containerClient.getBlobClient(key);

      const userDelegationKey = await this.serviceClient.getUserDelegationKey(
        new Date(),
        new Date(Date.now() + options.expiresInSeconds * 1000),
      );

      const permissions = new BlobSASPermissions();
      if (options.action === 'get') {
        permissions.read = true;
      } else {
        permissions.write = true;
        permissions.create = true;
      }

      const sasToken = generateBlobSASQueryParameters(
        {
          containerName: this.containerClient.containerName,
          blobName: key,
          permissions,
          expiresOn: new Date(Date.now() + options.expiresInSeconds * 1000),
          ...(options.contentType &&
            options.action === 'put' && {
              contentType: options.contentType,
            }),
          protocol: SASProtocol.Https,
        },
        userDelegationKey,
        this.config.accountName,
      );

      return `${blobClient.url}?${sasToken}`;
    } catch (error) {
      throw this.mapError(error, `Failed to generate presigned URL: ${key}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return await this.containerClient.getBlobClient(key).exists();
    } catch (error) {
      const mapped = this.mapError(error, `Failed to check existence: ${key}`);
      if (mapped.code === StorageErrorCode.NOT_FOUND) {
        return false;
      }
      throw mapped;
    }
  }

  getNativeClient<T = unknown>(): T {
    return this.serviceClient as T;
  }

  private mapError(error: unknown, message: string): StorageError {
    if (error instanceof StorageError) {
      return error;
    }

    const azureError = error as {
      statusCode?: number;
      details?: { errorCode?: string };
      code?: string;
    };
    const statusCode = azureError.statusCode;
    const errorCode = azureError.details?.errorCode || azureError.code || '';

    let code: StorageErrorCode;
    if (
      errorCode === 'BlobNotFound' ||
      errorCode === 'ContainerNotFound' ||
      statusCode === 404
    ) {
      code = StorageErrorCode.NOT_FOUND;
    } else if (
      errorCode === 'AuthorizationFailure' ||
      errorCode === 'AuthorizationPermissionMismatch' ||
      statusCode === 403
    ) {
      code = StorageErrorCode.ACCESS_DENIED;
    } else if (
      errorCode === 'BlobAlreadyExists' ||
      errorCode === 'ContainerAlreadyExists' ||
      statusCode === 409
    ) {
      code = StorageErrorCode.ALREADY_EXISTS;
    } else if (errorCode === 'ConditionNotMet' || statusCode === 412) {
      code = StorageErrorCode.PRECONDITION_FAILED;
    } else {
      code = StorageErrorCode.UNKNOWN;
    }

    return new StorageError(code, statusCode, 'azure-blob', error, message);
  }
}
