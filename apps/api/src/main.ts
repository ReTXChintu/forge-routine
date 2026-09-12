import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { ConfigurationError, loadConfig } from '@forgeroutine/config';

import { AppModule } from './app.module.js';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // A misconfigured deployment must fail here, loudly and readably, rather
    // than three hours later inside a request.
    if (error instanceof ConfigurationError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });
  const { env } = config;

  app.setGlobalPrefix(`${env.API_GLOBAL_PREFIX}/v1`);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.use(helmet());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  });

  // Code submissions are text; 1 MB is generous and caps a trivial DoS vector.
  app.useBodyParser('json', { limit: '1mb' });

  if (!config.isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('ForgeRoutine API')
        .setDescription('Forge your coding skills. Build your engineering mind.')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(`${env.API_GLOBAL_PREFIX}/docs`, app, document);
  }

  // Graceful shutdown: PM2 reloads workers one at a time, and an in-flight
  // submission must be allowed to finish writing before the process exits.
  app.enableShutdownHooks();

  await app.listen(env.API_PORT, env.API_HOST);

  logger.log(
    `ForgeRoutine API on http://${env.API_HOST}:${env.API_PORT}/${env.API_GLOBAL_PREFIX}/v1`,
  );
  logger.log(`Execution driver: ${env.EXECUTION_DRIVER}`);
  logger.log(
    `AI: ${config.aiEnabled ? `enabled (${env.AI_PROVIDER})` : 'disabled — agents will use fallbacks'}`,
  );
  if (!env.REDIS_ENABLED) logger.warn('Redis disabled — caching and queues are inactive');
}

void bootstrap();
