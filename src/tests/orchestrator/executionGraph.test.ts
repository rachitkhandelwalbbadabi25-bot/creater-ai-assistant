// src/tests/orchestrator/executionGraph.test.ts

import { describe, it, expect } from 'bun:test';
import { buildGraph, validateGraph, topologicalSort } from '../../orchestrator/executionGraph.js';

const simpleWorkflow = {
  taskId: 'w1',
  name: 'simple',
  steps: [
    { id: 'a', agent: 'os', action: 'openApp', args: {} },
    { id: 'b', agent: 'os', action: 'openApp', args: {} },
  ],
};

const dependentWorkflow = {
  taskId: 'w2',
  name: 'dependent',
  steps: [
    { id: 'a', agent: 'os', action: 'openApp', args: {} },
    { id: 'b', agent: 'os', action: 'openApp', args: {}, dependsOn: ['a'] },
    { id: 'c', agent: 'os', action: 'openApp', args: {}, dependsOn: ['b'] },
  ],
};

const circularWorkflow = {
  taskId: 'w3',
  name: 'circular',
  steps: [
    { id: 'a', agent: 'os', action: 'openApp', args: {}, dependsOn: ['c'] },
    { id: 'b', agent: 'os', action: 'openApp', args: {}, dependsOn: ['a'] },
    { id: 'c', agent: 'os', action: 'openApp', args: {}, dependsOn: ['b'] },
  ],
};

describe('executionGraph', () => {
  it('builds graph for simple workflow', () => {
    const g = buildGraph(simpleWorkflow);
    expect(Object.keys(g)).toHaveLength(2);
    expect(g['a']).toEqual([]);
    expect(g['b']).toEqual([]);
  });

  it('topological sort respects dependencies', () => {
    const g = buildGraph(dependentWorkflow);
    validateGraph(g);
    const order = topologicalSort(g);
    // a should come before b, b before c
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('detects circular dependencies', () => {
    const g = buildGraph(circularWorkflow);
    expect(() => validateGraph(g)).toThrow();
  });
});
