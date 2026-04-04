import { Inject } from '@nestjs/common';
import { STORAGE_BUCKET_PREFIX } from './storage.constants';

export function InjectStorage(bucketName: string): ParameterDecorator {
  return Inject(`${STORAGE_BUCKET_PREFIX}${bucketName}`);
}
