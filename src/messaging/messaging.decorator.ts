import { SetMetadata } from '@nestjs/common';
import { ON_MESSAGE_METADATA } from './messaging.constants';

/**
 * Decorator that marks a method as a handler for a messaging topic.
 *
 * The decorated method receives an `IncomingMessage` and should return a Promise.
 * - Resolving = message is XACK'd (acknowledged)
 * - Throwing  = message stays pending (will be retried, then sent to DLQ)
 *
 * @param topic - The topic name to subscribe to (e.g., 'user-created')
 */
export function OnMessage(topic: string): MethodDecorator {
  return SetMetadata(ON_MESSAGE_METADATA, topic);
}
