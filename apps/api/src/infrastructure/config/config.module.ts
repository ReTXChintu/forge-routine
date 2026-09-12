import { Global, Module } from '@nestjs/common';
import { type AppConfig, loadConfig } from '@forgeroutine/config';

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Loads and validates the environment exactly once, at boot.
 * A misconfigured deployment fails here with a readable message rather than
 * somewhere deep in a request three hours later.
 */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
