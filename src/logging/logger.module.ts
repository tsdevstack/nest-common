import { Module, Global, DynamicModule } from '@nestjs/common';
import { LoggerService } from './logger.service';
import type { LoggerModuleOptions } from './logger.interface';

@Global()
@Module({
  providers: [
    {
      provide: 'LOGGER_MODULE_OPTIONS',
      useValue: {},
    },
    LoggerService,
  ],
  exports: [LoggerService],
})
export class LoggerModule {
  /**
   * Configure the logger module with custom options
   *
   * @example
   * LoggerModule.forRoot({
   *   redactPaths: ['user.phoneNumber', 'order.paymentInfo'],
   *   redactCensor: '***',
   * })
   */
  static forRoot(options: LoggerModuleOptions = {}): DynamicModule {
    return {
      module: LoggerModule,
      global: true,
      providers: [
        {
          provide: 'LOGGER_MODULE_OPTIONS',
          useValue: options,
        },
        LoggerService,
      ],
      exports: [LoggerService],
    };
  }
}