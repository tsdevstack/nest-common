// Messaging Module
export { MessagingModule } from './messaging.module';

// Service
export { MessagingService } from './messaging.service';

// Decorator
export { OnMessage } from './messaging.decorator';

// Interfaces
export type {
  MessagingModuleOptions,
  IncomingMessage,
  MessageHandler,
} from './messaging.interface';

// Errors
export { MessagingError, MessagingErrorCode } from './messaging.error';
