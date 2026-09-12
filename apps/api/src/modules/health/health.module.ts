import { Module } from '@nestjs/common';

import { HealthController } from './http/health.controller.js';

@Module({ controllers: [HealthController] })
export class HealthModule {}
