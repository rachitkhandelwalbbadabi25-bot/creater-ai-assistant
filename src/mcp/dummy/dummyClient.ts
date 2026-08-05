// src/mcp/dummy/dummyClient.ts

/** Simple echo function for testing */
export async function echo(args: any): Promise<any> {
  return args;
}

/** Delayed function to simulate long work */
export async function slow(args: any): Promise<string> {
  const delay = typeof args?.delay === 'number' ? args.delay : 100;
  await new Promise((res) => setTimeout(res, delay));
  return 'finished';
}

/** Create and return a workflow artifact */
export async function createArtifact(args: {
  id: string;
  type: string;
  value: unknown;
}): Promise<{ id: string; type: string; value: unknown; createdAt: string }> {
  return {
    id: args.id,
    type: args.type,
    value: args.value,
    createdAt: new Date().toISOString(),
  };
}

/** Fail immediately – used to test compensation/retry logic */
export async function fail(_args: any): Promise<never> {
  throw new Error('dummy.fail: intentional failure');
}

/** Fail N times then succeed – used to test retry exhaustion */
export async function failThenSucceed(args: {
  failCount: number;
  _attempt?: number;
}): Promise<string> {
  // We track attempts via a module-level counter keyed by a caller-supplied ID
  const count = args.failCount ?? 1;
  if (count > 0) {
    args.failCount = count - 1;
    throw new Error('dummy.failThenSucceed: transient failure');
  }
  return 'eventually_succeeded';
}
