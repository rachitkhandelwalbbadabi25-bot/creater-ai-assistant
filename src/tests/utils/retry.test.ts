// src/tests/utils/retry.test.ts
import { test, expect } from 'bun:test';
import { retry, sleep } from '../../utils/retry.js';

/** Helper to create a promise that resolves after delay */
function delayedResolve<T>(value: T, ms: number): () => Promise<T> {
  return () => new Promise<T>((res) => setTimeout(() => res(value), ms));
}

/** Helper to create a promise that rejects after delay */
function delayedReject<T>(error: unknown, ms: number): () => Promise<T> {
  return () => new Promise<T>((_, rej) => setTimeout(() => rej(error), ms));
}

// Test: success on first attempt
await test('retry succeeds on first call', async () => {
  const result = await retry(() => Promise.resolve('ok'));
  expect(result).toBe('ok');
});

// Test: success after retries
await test('retry succeeds after one failure', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls === 1) throw new Error('first');
    return 'good';
  };
  const result = await retry(fn, { attempts: 3, delayMs: 10 });
  expect(result).toBe('good');
  expect(calls).toBe(2);
});

// Test: failure after max attempts
await test('retry fails after max attempts', async () => {
  const fn = delayedReject(new Error('boom'), 0);
  let caught = false;
  try {
    await retry(fn, { attempts: 2, delayMs: 5 });
  } catch (e) {
    caught = true;
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toBe('boom');
  }
  expect(caught).toBeTrue();
});

// Test: shouldRetry callback prevents further attempts
await test('shouldRetry callback can stop retrying', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new Error('stop');
  };
  let errMsg = '';
  try {
    await retry(fn, {
      attempts: 5,
      delayMs: 5,
      shouldRetry: (e) => {
        return !(e instanceof Error && e.message === 'stop');
      },
    });
  } catch (e) {
    errMsg = (e as Error).message;
  }
  expect(errMsg).toBe('stop');
  expect(calls).toBe(1);
});

// Test: AbortSignal cancellation
await test('retry respects AbortSignal', async () => {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 10);
  const fn = delayedReject(new Error('never'), 100);
  let aborted = false;
  try {
    await retry(fn, { signal: ctrl.signal, attempts: 3, delayMs: 5 });
  } catch (e) {
    aborted = true;
    expect(e).toBeInstanceOf(DOMException);
  }
  expect(aborted).toBeTrue();
});
