// src/orchestrator/executionGraph.ts

import { WorkflowDefinition, WorkflowStep } from './types.js';
import { OrchestratorError, CircularDependencyError as CDE } from './errors.js';


type AdjList = Record<string, string[]>;

/** Build adjacency list from workflow definition */
export function buildGraph(def: WorkflowDefinition): AdjList {
  const graph: AdjList = {};
  for (const step of def.steps) {
    graph[step.id] = [];
  }
  for (const step of def.steps) {
    if (step.dependsOn) {
      for (const dep of step.dependsOn) {
        if (!graph[dep]) {
          throw new OrchestratorError(`Dependency ${dep} not found for step ${step.id}`, 'INVALID_DEPENDENCY');
        }
        graph[dep].push(step.id);
      }
    }
  }
  return graph;
}

/** Detect cycles using DFS */
export function validateGraph(graph: AdjList): void {
  const visited = new Set<string>();
  const recStack = new Set<string>();

  const dfs = (node: string): boolean => {
    if (recStack.has(node)) return true; // cycle
    if (visited.has(node)) return false;
    visited.add(node);
    recStack.add(node);
    for (const neigh of graph[node] ?? []) {
      if (dfs(neigh)) return true;
    }
    recStack.delete(node);
    return false;
  };

  for (const node of Object.keys(graph)) {
    if (dfs(node)) {
      throw new CDE();
    }
  }
}

/** Return steps in topological order (Kahn's algorithm) */
export function topologicalSort(graph: AdjList): string[] {
  // compute indegree
  const indegree: Record<string, number> = {};
  for (const node of Object.keys(graph)) indegree[node] = 0;
  for (const node of Object.keys(graph)) {
    for (const neigh of graph[node]) {
      indegree[neigh] = (indegree[neigh] ?? 0) + 1;
    }
  }
  const queue: string[] = [];
  for (const [node, deg] of Object.entries(indegree)) {
    if (deg === 0) queue.push(node);
  }
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const neigh of graph[n]) {
      indegree[neigh]--;
      if (indegree[neigh] === 0) queue.push(neigh);
    }
  }
  if (order.length !== Object.keys(graph).length) {
    // should have been caught by validateGraph but safeguard
    throw new CDE();
  }
  return order;
}
