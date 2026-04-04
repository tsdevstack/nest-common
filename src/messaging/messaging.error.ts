export enum MessagingErrorCode {
  PUBLISH_FAILED = 'PUBLISH_FAILED',
  CONSUMER_FAILED = 'CONSUMER_FAILED',
  SERIALIZATION_FAILED = 'SERIALIZATION_FAILED',
}

export class MessagingError extends Error {
  constructor(
    public readonly code: MessagingErrorCode,
    public readonly topic: string,
    public readonly originalError: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'MessagingError';
  }
}
