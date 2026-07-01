# Phase 5.5 Resilience Layer Metrics & Definitions

The centralized resilience layer tracks operational safety metrics to observe and report recovery behaviors and service degradation in real-time.

## Centralized Resilience Metrics Schema

| Metric Field Name | Data Type | Purpose & Trigger Logic |
| :--- | :--- | :--- |
| `breakerTrips` | `Record<string, number>` | Track count of times each circuit breaker (e.g., `ollama`, `browser`, `api`, `shell`, `embedding`) trips to `OPEN`. |
| `breakerResets` | `Record<string, number>` | Track count of times each circuit breaker resets back to `CLOSED`. |
| `openCircuits` | `string[]` | Active list of services whose circuit breakers are currently `OPEN` and routing to fallbacks. |
| `fallbackExecutions`| `Record<string, number>` | Count of fallback executions triggered per service due to primary failure or open circuits. |
| `recoveryExecutions`| `number` | Total number of automatic recovery tasks initiated by the `RecoveryManager`. |
| `successfulRecoveries`| `number` | Total recovery actions successfully resolved. |
| `failedRecoveries` | `number` | Total recovery attempts that returned false or threw errors. |

---

## Metric Integrations

1. **Dashboard Representation**: The metrics are populated inside the main dashboard payload under `metrics.resilience`.
2. **Alert Trigger Boundaries**:
   - `circuit-open`: Warning alert triggered when any breaker transitions to `OPEN` (i.e. `openCircuits.length > 0`).
   - `recovery-failures`: Critical alert triggered when recovery attempts fail repeatedly (`failedRecoveries > 3`).
   - `fallback-excessive`: Warning alert triggered when fallback execution count exceeds 10 times.
