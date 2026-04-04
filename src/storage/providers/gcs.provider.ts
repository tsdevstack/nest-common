import { Readable } from 'node:stream';
import { Storage } from '@google-cloud/storage';
import type { Bucket, File } from '@google-cloud/storage';
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

export interface GCSProviderConfig {
  bucket: string;
  projectId?: string;
}

export class GCSStorageProvider implements StorageProvider {
  private readonly storage: Storage;
  private readonly bucket: Bucket;

  constructor(private readonly config: GCSProviderConfig) {
    this.storage = new Storage({
      ...(config.projectId && { projectId: config.projectId }),
    });
    this.bucket = this.storage.bucket(config.bucket);
  }

  async upload(
    key: string,
    body: Buffer | Readable | string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    try {
      const file = this.bucket.file(key);
      const metadata: Record<string, unknown> = {};

      if (options?.contentType) {
        metadata.contentType = options.contentType;
      }
      if (options?.contentDisposition) {
        metadata.contentDisposition = options.contentDisposition;
      }
      if (options?.cacheControl) {
        metadata.cacheControl = options.cacheControl;
      }
      if (options?.metadata) {
        metadata.metadata = options.metadata;
      }

      if (body instanceof Readable) {
        await this.uploadStream(file, body, metadata, options?.onProgress);
      } else {
        const buffer = typeof body === 'string' ? Buffer.from(body) : body;
        await file.save(buffer, {
          metadata,
          resumable: false,
        });

        if (options?.onProgress) {
          options.onProgress({
            loaded: buffer.length,
            total: buffer.length,
          });
        }
      }

      const [fileMetadata] = await file.getMetadata();
      return {
        etag: fileMetadata.etag as string | undefined,
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
      const file = this.bucket.file(key);
      const downloadOptions: Record<string, unknown> = {};

      if (options?.range) {
        downloadOptions.start = options.range.start;
        downloadOptions.end = options.range.end;
      }

      const [content] = await file.download(downloadOptions);
      const [metadata] = await file.getMetadata();

      return {
        body: Buffer.isBuffer(content) ? content : Buffer.from(content),
        contentType: metadata.contentType as string | undefined,
        contentLength: Number(metadata.size) || undefined,
        etag: metadata.etag as string | undefined,
        lastModified: metadata.updated
          ? new Date(metadata.updated as string)
          : undefined,
        metadata: (metadata.metadata as Record<string, string>) || undefined,
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
      const file = this.bucket.file(key);

      const [exists] = await file.exists();
      if (!exists) {
        throw this.createNotFoundError(key);
      }

      const streamOptions: Record<string, unknown> = {};
      if (options?.range) {
        streamOptions.start = options.range.start;
        streamOptions.end = options.range.end;
      }

      return file.createReadStream(streamOptions);
    } catch (error) {
      throw this.mapError(error, `Failed to download stream: ${key}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.bucket.file(key).delete();
    } catch (error) {
      const mapped = this.mapError(error, `Failed to delete object: ${key}`);
      if (mapped.code === StorageErrorCode.NOT_FOUND) {
        return;
      }
      throw mapped;
    }
  }

  async *list(options?: ListOptions): AsyncIterable<ObjectInfo> {
    let pageToken: string | undefined;
    let yielded = 0;
    const maxKeys = options?.maxKeys;

    try {
      do {
        const [files, , apiResponse] = await this.bucket.getFiles({
          prefix: options?.prefix,
          delimiter: options?.delimiter,
          pageToken,
          autoPaginate: false,
        });

        for (const file of files) {
          if (maxKeys !== undefined && yielded >= maxKeys) {
            return;
          }
          yield {
            key: file.name,
            size: file.metadata.size ? Number(file.metadata.size) : undefined,
            lastModified: file.metadata.updated
              ? new Date(file.metadata.updated as string)
              : undefined,
            etag: file.metadata.etag as string | undefined,
          };
          yielded++;
        }

        pageToken = (apiResponse as { nextPageToken?: string })?.nextPageToken;
      } while (pageToken);
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
      const sourceFile = this.bucket.file(sourceKey);
      const destFile = this.bucket.file(destinationKey);

      const copyOptions: Record<string, unknown> = {};
      if (options?.metadata) {
        copyOptions.metadata = { metadata: options.metadata };
      }

      const [, apiResponse] = await sourceFile.copy(destFile, copyOptions);

      return {
        etag: (apiResponse as { resource?: { etag?: string } })?.resource?.etag,
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
      const [metadata] = await this.bucket.file(key).getMetadata();

      return {
        contentType: metadata.contentType as string | undefined,
        contentLength: metadata.size ? Number(metadata.size) : undefined,
        contentDisposition: metadata.contentDisposition as string | undefined,
        cacheControl: metadata.cacheControl as string | undefined,
        etag: metadata.etag as string | undefined,
        lastModified: metadata.updated
          ? new Date(metadata.updated as string)
          : undefined,
        metadata: (metadata.metadata as Record<string, string>) || undefined,
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
      const file = this.bucket.file(key);

      const action = options.action === 'put' ? 'write' : 'read';
      const expires = Date.now() + options.expiresInSeconds * 1000;

      const signConfig: {
        version: 'v4';
        action: 'read' | 'write';
        expires: number;
        contentType?: string;
        virtualHostedStyle?: boolean;
      } = {
        version: 'v4',
        action,
        expires,
      };

      if (options.contentType && options.action === 'put') {
        signConfig.contentType = options.contentType;
      }

      const [url] = await file.getSignedUrl(signConfig);
      return url;
    } catch (error) {
      throw this.mapError(error, `Failed to generate presigned URL: ${key}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const [exists] = await this.bucket.file(key).exists();
      return exists;
    } catch (error) {
      const mapped = this.mapError(error, `Failed to check existence: ${key}`);
      if (mapped.code === StorageErrorCode.NOT_FOUND) {
        return false;
      }
      throw mapped;
    }
  }

  getNativeClient<T = unknown>(): T {
    return this.storage as T;
  }

  private async uploadStream(
    file: File,
    body: Readable,
    metadata: Record<string, unknown>,
    onProgress?: (progress: { loaded: number; total?: number }) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let loaded = 0;
      const writeStream = file.createWriteStream({
        metadata,
        resumable: true,
      });

      if (onProgress) {
        body.on('data', (chunk: Buffer) => {
          loaded += chunk.length;
          onProgress({ loaded });
        });
      }

      body.on('error', reject);
      body.pipe(writeStream).on('error', reject).on('finish', resolve);
    });
  }

  private createNotFoundError(key: string): StorageError {
    return new StorageError(
      StorageErrorCode.NOT_FOUND,
      404,
      'gcs',
      new Error(`Object not found: ${key}`),
      `Object not found: ${key}`,
    );
  }

  private mapError(error: unknown, message: string): StorageError {
    if (error instanceof StorageError) {
      return error;
    }

    const gcsError = error as {
      code?: number;
      errors?: Array<{ reason?: string }>;
    };
    const statusCode = gcsError.code;

    let code: StorageErrorCode;
    if (statusCode === 404) {
      code = StorageErrorCode.NOT_FOUND;
    } else if (statusCode === 403) {
      code = StorageErrorCode.ACCESS_DENIED;
    } else if (statusCode === 409) {
      code = StorageErrorCode.ALREADY_EXISTS;
    } else if (statusCode === 412) {
      code = StorageErrorCode.PRECONDITION_FAILED;
    } else {
      code = StorageErrorCode.UNKNOWN;
    }

    return new StorageError(code, statusCode, 'gcs', error, message);
  }
}
