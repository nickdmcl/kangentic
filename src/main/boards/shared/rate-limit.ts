/**
 * Shared throttle + exponential backoff utilities for board adapters.
 *
 * Not currently used by the stable adapters (they rely on the `gh` / `az`
 * CLIs to handle rate limits). Provided here so future HTTP-based adapters
 * (Linear, Jira, Trello, Asana) have a common retry policy.
 */

export interface BackoffOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/** Sleep for a given number of milliseconds. */
export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Run a function with exponential backoff on retryable errors. */
export async function withBackoff<T>(
  work: () => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxAttempts) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) break;
      const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
      await sleep(delay);
    }
  }
  throw lastError;
}
