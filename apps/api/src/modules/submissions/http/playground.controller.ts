import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { ScratchRunResult } from '@forgeroutine/shared-types';
import { runScratchSchema, type RunScratchInput } from '@forgeroutine/validation';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import { CODE_EXECUTION_PORT, type CodeExecutionPort } from '../ports/code-execution.port.js';

/**
 * Running code for its own sake.
 *
 * The "Try it out" button beside a worked example lands here. It exists so
 * that reading "reverse the array in place by swapping the ends" can be
 * followed immediately by doing it — which is the difference between
 * recognising an idea and having it.
 *
 * Nothing here is graded, recorded, scheduled or counted. No attempt is
 * opened, no skill moves, no routine row changes, and in particular no
 * `PracticeAssignment` is created — so trying an example out can never add to
 * what a concept needs before it is finished, and ignoring the button can
 * never hold anything up. That is a requirement, not an accident: optional
 * practice that quietly becomes compulsory is worse than no button.
 *
 * It is the same sandbox a submission uses, with no test cases. The isolation
 * is therefore identical; what differs is that the only thing kept is what
 * the code printed.
 */
@ApiTags('playground')
@Controller('playground')
@UseGuards(JwtAuthGuard)
export class PlaygroundController {
  constructor(@Inject(CODE_EXECUTION_PORT) private readonly execution: CodeExecutionPort) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run a scratch snippet and return what it printed. Never graded.' })
  async run(
    @Body(new ZodValidationPipe(runScratchSchema)) body: RunScratchInput,
  ): Promise<ScratchRunResult> {
    const result = await this.execution.run({
      code: body.code,
      language: body.language,
      // No tests, which is what makes this a scratchpad rather than a
      // submission. The harness skips its default-export requirement when
      // there is nothing to call.
      testCases: [],
    });

    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      truncated: result.truncated,
    };
  }
}
