export enum StorageErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  ACCESS_DENIED = 'ACCESS_DENIED',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  PRECONDITION_FAILED = 'PRECONDITION_FAILED',
  UNKNOWN = 'UNKNOWN',
}

export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    public readonly httpStatus: number | undefined,
    public readonly provider: string,
    public readonly originalError: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
