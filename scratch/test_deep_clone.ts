function deepClone<T>(value: T, seen = new WeakMap<object, any>()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (value instanceof Date) {
    const copy = new Date(value.getTime()) as unknown as T;
    seen.set(value, copy);
    return copy;
  }

  if (value instanceof RegExp) {
    const copy = new RegExp(value.source, value.flags) as unknown as T;
    seen.set(value, copy);
    return copy;
  }

  if (value instanceof Map) {
    const copy = new Map() as unknown as T;
    seen.set(value, copy);
    for (const [k, v] of (value as Map<any, any>).entries()) {
      (copy as Map<any, any>).set(deepClone(k, seen), deepClone(v, seen));
    }
    return copy;
  }

  if (value instanceof Set) {
    const copy = new Set() as unknown as T;
    seen.set(value, copy);
    for (const item of (value as Set<any>).values()) {
      (copy as Set<any>).add(deepClone(item, seen));
    }
    return copy;
  }

  if (Array.isArray(value)) {
    const copy: any[] = new Array(value.length);
    seen.set(value, copy);
    for (let i = 0; i < value.length; i++) {
      copy[i] = deepClone(value[i], seen);
    }
    return copy as unknown as T;
  }

  const proto = Object.getPrototypeOf(value);
  const copy: Record<string | symbol, any> = proto ? Object.create(proto) : {};
  seen.set(value, copy);

  for (const key of Reflect.ownKeys(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (desc) {
      if (typeof desc.value !== 'undefined') {
        copy[key] = deepClone((value as any)[key], seen);
      } else {
        Object.defineProperty(copy, key, desc);
      }
    }
  }

  return copy as unknown as T;
}

// 1. Test proactive job fixture with actionFn
let called = false;
const fixture: any = {
  taskId: "job_proactive_battery_check",
  status: "pending",
  steps: [],
  metadata: {
    workflowTemplate: {
      steps: [
        {
          name: "Battery Monitoring",
          type: "ACTION",
          input: {
            actionName: "checkBatteryAlert",
            actionFn: async () => { called = true; return "ok"; },
          }
        }
      ]
    }
  }
};

const cloned = deepClone(fixture);
console.log("Clone created without throwing DataCloneError!");
console.log("Is cloned !== fixture?", cloned !== fixture);
console.log("Is metadata cloned?", cloned.metadata !== fixture.metadata);
console.log("Is steps array cloned?", cloned.metadata.workflowTemplate.steps !== fixture.metadata.workflowTemplate.steps);

// Verify actionFn is callable
cloned.metadata.workflowTemplate.steps[0].input.actionFn().then((res: string) => {
  console.log("actionFn callable result:", res, "called:", called);
});

// Mutate clone and ensure original is untouched
cloned.metadata.workflowTemplate.steps[0].name = "Mutated Step";
console.log("Original step name:", fixture.metadata.workflowTemplate.steps[0].name);
console.log("Cloned step name:", cloned.metadata.workflowTemplate.steps[0].name);

// 2. Test circular reference
const circular: any = { name: "circ" };
circular.self = circular;
const clonedCirc = deepClone(circular);
console.log("Circular clone successful?", clonedCirc.self === clonedCirc && clonedCirc !== circular);
