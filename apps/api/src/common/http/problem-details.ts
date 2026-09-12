import { HttpException, HttpStatus } from '@nestjs/common';

import type { ProblemDetails } from '@forgeroutine/shared-types';

/**
 * RFC 9457 problem details — the only error shape the API emits (docs/api.md).
 *
 * A `type` URI per failure mode means clients can branch on the failure without
 * string-matching a message, and the message stays free to change.
 */

const BASE = 'https://forgeroutine.dev/errors';

export class ProblemException extends HttpException {
  constructor(problem: ProblemDetails) {
    super(problem, problem.status);
  }
}

function problem(
  type: string,
  title: string,
  status: HttpStatus,
  detail?: string,
  errors?: Record<string, string[]>,
): ProblemException {
  return new ProblemException({
    type: `${BASE}/${type}`,
    title,
    status,
    ...(detail ? { detail } : {}),
    ...(errors ? { errors } : {}),
  });
}

export const Problems = {
  validation: (errors: Record<string, string[]>) =>
    problem(
      'validation-failed',
      'Validation failed',
      HttpStatus.BAD_REQUEST,
      'One or more fields are invalid.',
      errors,
    ),

  unauthorized: (detail = 'Authentication is required.') =>
    problem('unauthorized', 'Unauthorized', HttpStatus.UNAUTHORIZED, detail),

  invalidCredentials: () =>
    problem(
      'invalid-credentials',
      'Invalid credentials',
      HttpStatus.UNAUTHORIZED,
      // Deliberately does not distinguish unknown email from wrong password:
      // that difference is a user-enumeration oracle.
      'That email and password combination is not recognised.',
    ),

  forbidden: (detail = 'You do not have access to this resource.') =>
    problem('forbidden', 'Forbidden', HttpStatus.FORBIDDEN, detail),

  notFound: (resource: string) =>
    problem('not-found', `${resource} not found`, HttpStatus.NOT_FOUND),

  emailTaken: () =>
    problem(
      'email-taken',
      'Email already registered',
      HttpStatus.CONFLICT,
      'An account with that email already exists.',
    ),

  exerciseLocked: (blockingConcept: string) =>
    problem(
      'exercise-locked',
      'Exercise locked',
      HttpStatus.CONFLICT,
      `Complete the prerequisite concept '${blockingConcept}' first.`,
    ),

  attemptClosed: () =>
    problem(
      'attempt-closed',
      'Attempt already completed',
      HttpStatus.CONFLICT,
      'Start a new attempt to submit again.',
    ),

  assistanceGated: (reason: string) =>
    problem('assistance-gated', 'Assistance gated', HttpStatus.CONFLICT, reason),

  rateLimited: (retryAfterSeconds: number) =>
    problem(
      'rate-limited',
      'Too many requests',
      HttpStatus.TOO_MANY_REQUESTS,
      `Try again in ${retryAfterSeconds} seconds.`,
    ),

  aiUnavailable: () =>
    problem(
      'ai-unavailable',
      'AI assistance unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
      'AI is not configured or is temporarily unreachable.',
    ),

  internal: () => problem('internal', 'Internal server error', HttpStatus.INTERNAL_SERVER_ERROR),
} as const;
