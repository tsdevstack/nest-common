import { Readable } from 'node:stream';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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

export interface S3ProviderConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: {
    accessKey: string;
    secretKey: string;
  };
}

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: S3ProviderConfig) {
    this.bucket = config.bucket;

    const clientConfig: S3ClientConfig = {
      region: config.region || process.env.AWS_REGION || 'us-east-1',
      ...(config.endpoint && { endpoint: config.endpoint }),
      ...(config.forcePathStyle && { forcePathStyle: true }),
      ...(config.credentials && {
        credentials: {
          accessKeyId: config.credentials.accessKey,
          secretAccessKey: config.credentials.secretKey,
        },
      }),
    };

    this.client = new S3Client(clientConfig);
  }

  async upload(
    key: string,
    body: Buffer | Readable | string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    try {
      if (body instanceof Readable) {
        const upload = new Upload({
          client: this.client,
          params: {
            Bucket: this.bucket,
            Key: key,
            Body: body,
            ContentType: options?.contentType,
            ContentDisposition: options?.contentDisposition,
            CacheControl: options?.cacheControl,
            Metadata: options?.metadata,
          },
        });

        if (options?.onProgress) {
          upload.on('httpUploadProgress', (progress) => {
            options.onProgress!({
              loaded: progress.loaded ?? 0,
              total: progress.total,
            });
          });
        }

        const result = await upload.done();
        return {
          etag: result.ETag,
          versionId: result.VersionId,
        };
      }

      const result = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: typeof body === 'string' ? Buffer.from(body) : body,
          ContentType: options?.contentType,
          ContentDisposition: options?.contentDisposition,
          CacheControl: options?.cacheControl,
          Metadata: options?.metadata,
        }),
      );

      return {
        etag: result.ETag,
        versionId: result.VersionId,
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
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(options?.range && {
            Range: `bytes=${options.range.start}-${options.range.end}`,
          }),
        }),
      );

      const stream = result.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array),
        );
      }

      return {
        body: Buffer.concat(chunks),
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        etag: result.ETag,
        lastModified: result.LastModified,
        metadata: result.Metadata,
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
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ...(options?.range && {
            Range: `bytes=${options.range.start}-${options.range.end}`,
          }),
        }),
      );

      return result.Body as Readable;
    } catch (error) {
      throw this.mapError(error, `Failed to download stream: ${key}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      const mapped = this.mapError(error, `Failed to delete object: ${key}`);
      if (mapped.code === StorageErrorCode.NOT_FOUND) {
        return;
      }
      throw mapped;
    }
  }

  async *list(options?: ListOptions): AsyncIterable<ObjectInfo> {
    let continuationToken: string | undefined;
    let yielded = 0;
    const maxKeys = options?.maxKeys;

    try {
      do {
        const result = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: options?.prefix,
            Delimiter: options?.delimiter,
            ContinuationToken: continuationToken,
          }),
        );

        if (result.Contents) {
          for (const item of result.Contents) {
            if (maxKeys !== undefined && yielded >= maxKeys) {
              return;
            }
            yield {
              key: item.Key!,
              size: item.Size,
              lastModified: item.LastModified,
              etag: item.ETag,
            };
            yielded++;
          }
        }

        continuationToken = result.IsTruncated
          ? result.NextContinuationToken
          : undefined;
      } while (continuationToken);
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
      const result = await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          CopySource: `${this.bucket}/${sourceKey}`,
          Key: destinationKey,
          ...(options?.metadata && {
            Metadata: options.metadata,
            MetadataDirective: 'REPLACE',
          }),
        }),
      );

      return {
        etag: result.CopyObjectResult?.ETag,
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
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
        contentDisposition: result.ContentDisposition,
        cacheControl: result.CacheControl,
        etag: result.ETag,
        lastModified: result.LastModified,
        metadata: result.Metadata,
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
      const command =
        options.action === 'put'
          ? new PutObjectCommand({
              Bucket: this.bucket,
              Key: key,
              ...(options.contentType && {
                ContentType: options.contentType,
              }),
            })
          : new GetObjectCommand({
              Bucket: this.bucket,
              Key: key,
            });

      return await getSignedUrl(this.client, command, {
        expiresIn: options.expiresInSeconds,
      });
    } catch (error) {
      throw this.mapError(error, `Failed to generate presigned URL: ${key}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (error) {
      const mapped = this.mapError(error, `Failed to check existence: ${key}`);
      if (mapped.code === StorageErrorCode.NOT_FOUND) {
        return false;
      }
      throw mapped;
    }
  }

  getNativeClient<T = unknown>(): T {
    return this.client as T;
  }

  private mapError(error: unknown, message: string): StorageError {
    if (error instanceof StorageError) {
      return error;
    }

    const awsError = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    const statusCode = awsError.$metadata?.httpStatusCode;
    const errorName = awsError.name || '';

    let code: StorageErrorCode;
    if (
      errorName === 'NoSuchKey' ||
      errorName === 'NotFound' ||
      statusCode === 404
    ) {
      code = StorageErrorCode.NOT_FOUND;
    } else if (
      errorName === 'AccessDenied' ||
      errorName === 'Forbidden' ||
      statusCode === 403
    ) {
      code = StorageErrorCode.ACCESS_DENIED;
    } else if (
      errorName === 'BucketAlreadyExists' ||
      errorName === 'BucketAlreadyOwnedByYou' ||
      statusCode === 409
    ) {
      code = StorageErrorCode.ALREADY_EXISTS;
    } else if (errorName === 'PreconditionFailed' || statusCode === 412) {
      code = StorageErrorCode.PRECONDITION_FAILED;
    } else {
      code = StorageErrorCode.UNKNOWN;
    }

    return new StorageError(code, statusCode, 's3', error, message);
  }
}
