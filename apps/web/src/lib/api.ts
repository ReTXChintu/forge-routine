import type { ProblemDetails } from '@forgeroutine/shared-types';

/**
 * Typed API client.
 *
 * Errors always arrive as RFC 9457 problem documents, so `ApiError` carries the
 * `type` URI and callers can branch on the failure mode instead of matching on a
 * message that is free to change.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

const ACCESS_TOKEN_KEY = 'forgeroutine.accessToken';
const REFRESH_TOKEN_KEY = 'forgeroutine.refreshToken';

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get status(): number {
    return this.problem.status;
  }

  /** `exercise-locked`, `assistance-gated`, … */
  get kind(): string {
    return this.problem.type.split('/').pop() ?? 'error';
  }

  /** Field errors from a validation failure, if any. */
  get fieldErrors(): Record<string, string[]> {
    return this.problem.errors ?? {};
  }
}

export const tokenStore = {
  get access(): string | null {
    return safeRead(ACCESS_TOKEN_KEY);
  },
  get refresh(): string | null {
    return safeRead(REFRESH_TOKEN_KEY);
  },
  set(accessToken: string, refreshToken: string): void {
    safeWrite(ACCESS_TOKEN_KEY, accessToken);
    safeWrite(REFRESH_TOKEN_KEY, refreshToken);
  },
  clear(): void {
    safeRemove(ACCESS_TOKEN_KEY);
    safeRemove(REFRESH_TOKEN_KEY);
  },
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Internal: prevents an infinite refresh loop. */
  isRetry?: boolean;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, idempotencyKey, signal, isRetry = false } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const accessToken = tokenStore.access;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });

  // One transparent refresh attempt. Without the isRetry guard an expired
  // refresh token would spin forever.
  if (response.status === 401 && !isRetry && tokenStore.refresh) {
    const refreshed = await tryRefresh();
    if (refreshed) return apiRequest<T>(path, { ...options, isRetry: true });
    tokenStore.clear();
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      isProblemDetails(payload)
        ? payload
        : {
            type: 'https://forgeroutine.dev/errors/unknown',
            title: 'Request failed',
            status: response.status,
          },
    );
  }

  return payload as T;
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) return false;

    const tokens = (await response.json()) as { accessToken: string; refreshToken: string };
    tokenStore.set(tokens.accessToken, tokens.refreshToken);
    return true;
  } catch {
    return false;
  }
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  return typeof value === 'object' && value !== null && 'title' in value && 'status' in value;
}

// localStorage throws in private-browsing contexts; a storage failure must not
// take down the app.
function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Session lasts only as long as the tab. Acceptable. */
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Nothing to do. */
  }
}
