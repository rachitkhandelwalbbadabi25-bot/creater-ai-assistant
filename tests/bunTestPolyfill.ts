// Polyfill for bun:test so tests can be run via bun test or node/tsx
import assert from "node:assert";
let bunTest: any;
try {
  bunTest = await import("bun:test");
} catch {}

let testQueue: Array<() => Promise<void>> = [];
let isRunning = false;
let currentBeforeEach: (() => void | Promise<void>) | null = null;

async function processQueue() {
  if (isRunning) return;
  isRunning = true;
  await new Promise((r) => setTimeout(r, 50));
  let hasErrors = false;
  while (testQueue.length > 0) {
    const item = testQueue.shift()!;
    try {
      if (currentBeforeEach) await currentBeforeEach();
    } catch {}
    try {
      await item();
    } catch (e) {
      hasErrors = true;
    }
  }
  isRunning = false;
  setTimeout(() => {
    process.exit(hasErrors ? 1 : 0);
  }, 100);
}

export const describe = bunTest?.describe || function(name: string, fn: () => void | Promise<void>) {
  console.log(`\n--- [SUITE] ${name} ---`);
  fn();
};

export const test = bunTest?.test || function(name: string, fn: () => void | Promise<void>) {
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
};

export const it = bunTest?.it || test;

export const beforeEach = bunTest?.beforeEach || function(fn: () => void | Promise<void>) {
  currentBeforeEach = fn;
};

export const afterEach = bunTest?.afterEach || function(fn: () => void | Promise<void>) {};
export const beforeAll = bunTest?.beforeAll || function(fn: () => void | Promise<void>) {};
export const afterAll = bunTest?.afterAll || function(fn: () => void | Promise<void>) {};

export const mock = bunTest?.mock || function<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
};

export function polyfillExpect(actual: any) {
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
    toBeLessThan(expected: number) {
      assert.ok(actual < expected, `Expected ${actual} < ${expected}`);
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

export const expect = bunTest?.expect || polyfillExpect;

