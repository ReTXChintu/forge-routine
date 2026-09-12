import { Module } from '@nestjs/common';

import { CurriculumImportService } from './application/curriculum-import.service.js';

@Module({
  providers: [CurriculumImportService],
  exports: [CurriculumImportService],
})
export class CurriculumModule {}
