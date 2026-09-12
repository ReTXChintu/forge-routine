import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import type { ProblemDetails } from '@forgeroutine/shared-types';

/**
 * Converts every escaping error into RFC 9457 `application/problem+json`.
 *
 * Two rules matter here:
 *  - Unexpected errors are logged in full and reported as a bare 500. Leaking an
 *    internal message or stack to the client is how database structure and file
 *    paths end up in bug reports.
 *  - Expected errors (already ProblemDetails) pass through untouched.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const problem = this.toProblem(exception, request.url);

    if (problem.status >= 500) {
      this.logger.error(
        { err: exception, path: request.url, method: request.method },
        'Unhandled error',
      );
    }

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, instance: string): ProblemDetails {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();

      // Already a problem document from Problems.*
      if (isProblemDetails(body)) {
        return { ...body, instance };
      }

      // A stock Nest exception (e.g. from a guard); wrap it in the same shape.
      const status = exception.getStatus();
      const detail =
        typeof body === 'string'
          ? body
          : typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : undefined;

      return {
        type: `https://forgeroutine.dev/errors/${slugForStatus(status)}`,
        title: exception.message,
        status,
        ...(detail ? { detail } : {}),
        instance,
      };
    }

    return {
      type: 'https://forgeroutine.dev/errors/internal',
      title: 'Internal server error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      instance,
    };
  }
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'title' in value &&
    'status' in value
  );
}

function slugForStatus(status: number): string {
  const names: Record<number, string> = {
    400: 'bad-request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not-found',
    409: 'conflict',
    429: 'rate-limited',
  };
  return names[status] ?? 'error';
}
