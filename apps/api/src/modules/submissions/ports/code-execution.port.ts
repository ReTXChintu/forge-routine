import type { ExecutionResult, SupportedLanguage } from '@forgeroutine/shared-types';

export const CODE_EXECUTION_PORT = Symbol('CODE_EXECUTION_PORT');

export interface ExecutionJob {
  code: string;
  language: SupportedLanguage;
  testCases: readonly { name: string; hidden: boolean; code: string }[];
}

/**
 * The application layer depends only on this.
 *
 * Both drivers (inline child process, queued worker) implement it, and a future
 * container or microVM backend will too — without the learning domain noticing
 * (docs/code-execution.md).
 */
export interface CodeExecutionPort {
  run(job: ExecutionJob): Promise<ExecutionResult>;
}
