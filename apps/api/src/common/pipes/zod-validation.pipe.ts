import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';

import { Problems } from '../http/problem-details.js';

/**
 * Validates a payload against a Zod schema and returns the *parsed* value, so
 * defaults and coercions defined in @forgeroutine/validation actually take effect.
 *
 * Nothing reaches a use-case unvalidated (§45.6).
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw Problems.validation(toFieldErrors(error));
      }
      throw error;
    }
  }
}

function toFieldErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}
