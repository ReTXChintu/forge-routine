import { Module } from '@nestjs/common';

import { SessionsService } from './application/sessions.service.js';
import { SessionsController } from './http/sessions.controller.js';

@Module({
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
