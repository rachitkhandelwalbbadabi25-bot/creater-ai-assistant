// Polyfill for bun:test so tests can be run via node/tsx
import assert from "node:assert";

let testQueue: Array<() => Promise<void>> = [];
let isRunning = false;

async function processQueue() {
  if (isRunning) return;
  isRunning = true;
  while (testQueue.length > 0) {
    const fn = testQueue.shift()!;
    try {
      if (currentBeforeEach) await currentBeforeEach();
    } catch {}
    await fn();
  }
  isRunning = false;
}

export function describe(name: string, fn: () => void | Promise<void>) {
  console.log(`\n--- [SUITE] ${name} ---`);
  fn();
}

export function test(name: string, fn: () => void | Promise<void>) {
  testQueue.push(async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e: any) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${e.stack || e.message || e}`);
    }
  });
  processQueue();
}

export const it = test;

let currentBeforeEach: (() => void | Promise<void>) | null = null;

export function beforeEach(fn: () => void | Promise<void>) {
  currentBeforeEach = fn;
}

export function afterEach(fn: () => void | Promise<void>) {}
export function beforeAll(fn: () => void | Promise<void>) {}
export function afterAll(fn: () => void | Promise<void>) {}

export function mock<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}

export function expect(actual: any) {
  const matcher = {
    toBe(expected: any) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected: any) {
      assert.deepStrictEqual(actual, expected);
    },
    toBeTruthy() {
      assert.ok(actual);
    },
    toBeFalsy() {
      assert.ok(!actual);
    },
    toBeDefined() {
      assert.ok(actual !== undefined, "Expected value to be defined");
    },
    toBeUndefined() {
      assert.strictEqual(actual, undefined);
    },
    toBeNull() {
      assert.strictEqual(actual, null);
    },
    toContain(expected: any) {
      if (typeof actual === "string" || Array.isArray(actual)) {
        assert.ok(actual.includes(expected), `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
      } else {
        assert.fail(`actual is not string or array`);
      }
    },
    toMatch(pattern: RegExp) {
      assert.ok(pattern.test(String(actual)), `Expected "${actual}" to match ${pattern}`);
    },
    toHaveLength(expected: number) {
      assert.strictEqual(actual?.length, expected);
    },
    toHaveProperty(propName: string) {
      assert.ok(actual && Object.prototype.hasOwnProperty.call(actual, propName), `Expected object to have property ${propName}`);
    },
    toBeGreaterThan(expected: number) {
      assert.ok(actual > expected, `Expected ${actual} > ${expected}`);
    },
    toBeGreaterThanOrEqual(expected: number) {
      assert.ok(actual >= expected, `Expected ${actual} >= ${expected}`);
    },
    toBeCloseTo(expected: number, precision: number = 2) {
      const diff = Math.abs(actual - expected);
      assert.ok(diff < Math.pow(10, -precision), `Expected ${actual} to be close to ${expected}`);
    },
    toThrow(expected?: any) {
      if (typeof actual === "function") {
        try {
          const res = actual();
          if (res && typeof res.then === "function") {
            return res.then(
              () => { assert.fail("Expected async function to throw, but it succeeded"); },
              (err: any) => {
                if (expected) {
                  if (expected instanceof RegExp) {
                    assert.ok(expected.test(err.message || String(err)), `Error message "${err.message}" did not match ${expected}`);
                  } else if (typeof expected === "string") {
                    assert.ok(String(err.message || err).includes(expected), `Error message did not contain ${expected}`);
                  }
                }
              }
            );
          }
        } catch (e: any) {
          if (expected) {
            if (expected instanceof RegExp) {
              assert.ok(expected.test(e.message || String(e)), `Error message "${e.message}" did not match ${expected}`);
            } else if (typeof expected === "string") {
              assert.ok(String(e.message || e).includes(expected), `Error message did not contain ${expected}`);
            }
          }
        }
      }
    },
    rejects: {
      toThrow(expected?: any) {
        if (actual && typeof actual.then === "function") {
          return actual.then(
            () => { assert.fail("Expected promise to reject, but it resolved"); },
            (err: any) => {
              if (expected) {
                if (expected instanceof RegExp) {
                  assert.ok(expected.test(err.message || String(err)), `Error message "${err.message}" did not match ${expected}`);
                } else if (typeof expected === "string") {
                  assert.ok(String(err.message || err).includes(expected), `Error message did not contain ${expected}`);
                }
              }
            }
          );
        }
      }
    }
  };

  return matcher;
}

