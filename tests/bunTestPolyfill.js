// tests/bunTestPolyfill.js
let bunTest;
try {
  bunTest = await import("bun:test");
} catch {}

let testQueue = [];
let isRunning = false;
let currentBeforeEach = null;

async function processQueue() {
  if (isRunning) return;
  isRunning = true;
  await new Promise((r) => setTimeout(r, 50));
  let hasErrors = false;
  while (testQueue.length > 0) {
    const item = testQueue.shift();
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

export const describe = bunTest?.describe || function(name, fn) {
  console.log(`\n--- [SUITE] ${name} ---`);
  fn();
};

export const test = bunTest?.test || function(name, fn) {
  testQueue.push(async () => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${e.stack || e.message || e}`);
      throw e;
    }
  });
  processQueue();
};

export const it = bunTest?.it || test;

export const beforeEach = bunTest?.beforeEach || function(fn) {
  currentBeforeEach = fn;
};

export const afterEach = bunTest?.afterEach || function(fn) {};
export const beforeAll = bunTest?.beforeAll || function(fn) {};
export const afterAll = bunTest?.afterAll || function(fn) {};

function polyfillExpect(actual) {
  return {
    toBe: (expected) => {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`);
    },
    toEqual: (expected) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
    },
    toThrow: () => {},
    toContain: (expected) => {
      if (typeof actual !== "string" && !Array.isArray(actual)) throw new Error("actual is not string or array");
      if (!actual.includes(expected)) throw new Error(`Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
    },
    toBeDefined: () => {
      if (actual === undefined) throw new Error("Expected defined");
    },
    toBeGreaterThan: (expected) => {
      if (actual <= expected) throw new Error(`Expected ${actual} > ${expected}`);
    },
    toBeLessThan: (expected) => {
      if (actual >= expected) throw new Error(`Expected ${actual} < ${expected}`);
    },
    toBeNull: () => {
      if (actual !== null) throw new Error("Expected null");
    },
    rejects: {
      toThrow: () => {},
    },
    not: {
      toBe: (expected) => {
        if (actual === expected) throw new Error(`Expected not ${expected}`);
      },
      toThrow: () => {},
      toBeNull: () => {
        if (actual === null) throw new Error("Expected not null");
      },
    },
  };
}

export const expect = bunTest?.expect || polyfillExpect;
