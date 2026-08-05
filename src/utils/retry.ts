// src/utils/retry.ts
/**
 * Sleep for the given number of milliseconds.
 * Supports AbortSignal – if the signal is aborted before the timeout expires,
 * the promise rejects with an AbortError.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }
    const timeout = setTimeout(() => resolve(), ms);
    const abortHandler = () => {
      clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abortHandler, { once: true });
  });
}

export interface RetryOptions {
  attempts?: number; // total attempts, including the first call
  delayMs?: number; // base delay before first retry
  backoffMultiplier?: number; // exponential backoff factor
  signal?: AbortSignal; // optional cancellation token
  /**
   * Return true if the operation should be retried for the given error.
   * If omitted, all errors are retried until attempts are exhausted.
   */
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Generic retry utility with deterministic exponential backoff.
 *
 * @param fn   Async function to execute.
 * @param opts Configuration options.
 * @returns    Resolved value of `fn`.
 * @throws     The original error if all attempts fail or shouldRetry returns false.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    attempts = 3,
    delayMs = 500,
    backoffMultiplier = 2,
    signal,
    shouldRetry,
  } = opts;

  let attempt = 0;
  let lastError: unknown;

  while (attempt < attempts) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Decide whether we should retry this error
      const retryable = shouldRetry ? shouldRetry(err) : true;
      if (!retryable) {
        throw err;
      }
      attempt++;
      if (attempt >= attempts) {
        break;
      }
      const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);
      await sleep(delay, signal);
    }
  }
  // All attempts exhausted – re‑throw the last error
  throw lastError as unknown;
}
