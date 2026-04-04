import type { Readable } from 'node:stream';

export interface UploadOptions {
  contentType?: string;
  contentDisposition?: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  onProgress?: (progress: { loaded: number; total?: number }) => void;
}

export interface UploadResult {
  etag?: string;
  versionId?: string;
}

export interface DownloadOptions {
  range?: { start: number; end: number };
}

export interface DownloadResult {
  body: Buffer;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
}

export interface ListOptions {
  prefix?: string;
  delimiter?: string;
  maxKeys?: number;
}

export interface ObjectInfo {
  key: string;
  size?: number;
  lastModified?: Date;
  etag?: string;
}

export interface ObjectMetadata {
  contentType?: string;
  contentLength?: number;
  contentDisposition?: string;
  cacheControl?: string;
  etag?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
}

export interface PresignedUrlOptions {
  action: 'get' | 'put';
  expiresInSeconds: number;
  contentType?: string;
}

export interface CopyOptions {
  metadata?: Record<string, string>;
}

export interface CopyResult {
  etag?: string;
}

export interface StorageProvider {
  upload(
    key: string,
    body: Buffer | Readable | string,
    options?: UploadOptions,
  ): Promise<UploadResult>;

  download(key: string, options?: DownloadOptions): Promise<DownloadResult>;

  downloadStream(key: string, options?: DownloadOptions): Promise<Readable>;

  delete(key: string): Promise<void>;

  list(options?: ListOptions): AsyncIterable<ObjectInfo>;

  copy(
    sourceKey: string,
    destinationKey: string,
    options?: CopyOptions,
  ): Promise<CopyResult>;

  getMetadata(key: string): Promise<ObjectMetadata>;

  getPresignedUrl(key: string, options: PresignedUrlOptions): Promise<string>;

  exists(key: string): Promise<boolean>;

  getNativeClient<T = unknown>(): T;
}
