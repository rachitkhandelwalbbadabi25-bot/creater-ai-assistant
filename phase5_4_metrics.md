# Phase 5.4 Metric Definitions & Parameters

The metrics tracking modules capture data structures mapping the following key system indices:

## 1. System Performance Index

| Metric name | Description | Source / Resolution |
| --- | --- | --- |
| `uptimeMs` | Process activity time (ms) | `Date.now() - startTime` |
| `memoryUsage` | Node process memory distribution | `process.memoryUsage()` |
| `cpuUsage` | Virtual process usage footprint | `process.cpuUsage()` derived |
| `requestCount` | Cumulative operations executed | System instrumentation |
| `activeRequests` | In-progress requests counter | System instrumentation |
| `failedRequests` | Processing failures | System instrumentation |
| `averageLatencyMs` | Sum execution time divided by calls | Dynamic calculation |
| `p50LatencyMs` | Median response execution time | Dynamic percentile |
| `p95LatencyMs` | 95th-percentile execution latency | Dynamic percentile |
| `p99LatencyMs` | 99th-percentile execution latency | Dynamic percentile |
| `maxLatencyMs` | Worst-case transaction processing time | Dynamic percentile |
| `queueSize` | Queue concurrency footprint size | Thread scheduling limits |

## 2. Model Execution (Ollama) Index

- `load_ms`: Execution time for runner model preloading.
- `prompt_eval_ms`: Overhead analysis for incoming tokens.
- `eval_ms`: LLM execution generation latency.
- `first_token_ms`: First token delivery latency.
- `total_ms`: Absolute operation cycle runtime.
- `tokenPerSecond`: Total evaluation throughput (tokens/sec).
- `activeOperations`: Parallel runner request count.
- `queueWaitMs`: Concurrency execution lock overhead.
