# Creater AI — Next Steps
## Source-grounded development plan

### First: Do not jump directly into another major feature

The project discussions repeatedly established that stabilization comes before adding major new capabilities.

The explicitly revised roadmap puts the project at:

```text
Phase 4        Complete
       ↓
Phase 4.1      Stabilization  ← CURRENT
       ↓
Phase 5        CUA Foundation
       ↓
Phase 5.5      OS MCP + Filesystem MCP
       ↓
Phase 6        Workflow Engine + Cron
       ↓
Phase 7        Monitoring + Background Jobs
       ↓
Phase 8        Advanced CUA + Multi-MCP
       ↓
Phase 9        Voice + Wake Word
       ↓
Phase 10       Proactive Cognitive OS
```

Source: `Roadmap Evolution Discussion.txt`. fileciteturn113file0L77-L130

---

# STEP 1 — Finish Stabilization

This is the immediate priority.

## 1. Runtime Stability
Verify/fix:
- runtime errors
- unresolved async issues
- memory leaks
- lag
- shutdown/cleanup behavior

## 2. Browser Stability
Verify/fix:
- browser lifecycle
- browser sessions
- duplicate/competing browser paths
- timeout behavior
- retries
- cleanup

## 3. Execution Stability
Verify/fix:
- screenshot aliases
- folder/path normalization
- execution edge cases
- workflow cleanup

## 4. Performance
Then optimize:
- regex work
- logging volume
- embedding queue
- dispatcher performance

## 5. UX
Then verify:
- WebUI timeout handling
- loading states
- streaming indicators
- graceful fallback errors

## 6. Validation
Run:
- workflow stress tests
- long-session tests
- browser continuity tests
- memory monitoring
- multi-command tests

This exact stabilization sequence was discussed previously. fileciteturn113file3L635-L741

---

# STEP 2 — Verify the Existing Architecture

Before adding more systems, verify what is already present.

### Conversation
Check that there is one clear path for:
```text
input
→ intent/state
→ context
→ response/execution decision
```

### Memory
Check:
```text
retrieve relevant memory
→ inject context
→ maintain continuity
```

### Planner
Keep the rule:
```text
Planner = decomposition
Runtime = execution
```

This separation was explicitly part of the roadmap. fileciteturn113file9L1755-L1767

### Tool Registry
Keep structured:
```text
registerTool()
executeTool()
validateTool()
```

not free-form execution. fileciteturn113file6L1289-L1310

---

# STEP 3 — Phase 5: CUA Foundation

Only after stabilization is considered complete.

The revised roadmap names **CUA Foundation** as the next major phase.

The earlier roadmap describes GUI as:

```text
fallback execution
```

not the primary execution mechanism.

Source: `Roadmap Evolution Discussion.txt` and `Memory Saved for Future.txt`. fileciteturn113file0L82-L102 fileciteturn113file2L561-L566

So the goal is not "make everything GUI-controlled."

The goal is a reliable fallback layer for cases where structured tools cannot perform the task.

---

# STEP 4 — Phase 5.5: OS MCP + Filesystem MCP

After CUA foundation:

## OS MCP
The earlier plan included capabilities around:
- opening applications
- clipboard
- notifications
- screenshots
- process checks

## Filesystem MCP
The earlier plan included:
- read file
- write file
- move file
- search files
- create folder

These should integrate with the existing tool/execution architecture rather than become a second execution brain.

---

# STEP 5 — Phase 6: Workflow Engine + Cron

This is where scheduling becomes more deeply connected to workflows.

The earlier workflow direction includes:

```text
sequential tasks
parallel tasks
retries
checkpoints
```

and later:

```text
delayed workflows
recurring tasks
recovery execution
```

Source: `Memory Saved for Future.txt`. fileciteturn113file9L1863-L1935

The existing scheduler should evolve toward this; do not casually create a second independent scheduler.

---

# STEP 6 — Phase 7: Monitoring + Background Jobs

Monitoring/telemetry is important because once workflows, agents, schedulers and retries grow, debugging becomes difficult.

The previously discussed observability targets were:

- execution logs
- agent tracing
- tool traces
- workflow replay
- metrics
- state snapshots

Source: `Memory Saved for Future.txt`. fileciteturn113file4L783-L822

The repository already contains monitoring/resilience infrastructure, so this phase should be treated as **verification, hardening and expansion**, not automatically as "build monitoring from zero."

---

# STEP 7 — Phase 8: Advanced CUA + Multi-MCP

Later expand CUA and coordinate multiple capability systems.

The principle remains:

```text
Conversation
    ↓
Planner
    ↓
Internal Orchestrator
    ↓
Tool Registry / MCP capabilities
    ↓
Execution
```

The orchestrator remains part of the internal runtime architecture.

---

# STEP 8 — Phase 9: Voice + Wake Word

The repository already has voice-related foundations, but the later roadmap milestone should mean the complete user-facing interaction loop is actually reliable.

Do not mark this complete only because wake-word/STT modules exist.

---

# STEP 9 — Phase 10: Proactive Cognitive OS

This is intentionally late.

The project discussions define the eventual target as:

- proactive intelligence
- deciding when to help
- deciding when NOT to interrupt
- long-horizon workflows
- persistent agents
- distributed orchestration

Source: `Memory Saved for Future.txt`. fileciteturn113file7L1470-L1503

---

# The Development Order

```text
CURRENT
Phase 4.1 Stabilization
        ↓
Phase 5 CUA Foundation
        ↓
Phase 5.5 OS + Filesystem MCP
        ↓
Phase 6 Workflow Engine + Cron
        ↓
Phase 7 Monitoring + Background Jobs
        ↓
Phase 8 Advanced CUA + Multi-MCP
        ↓
Phase 9 Voice + Wake Word
        ↓
Phase 10 Proactive Cognitive OS
```

---

# The Architecture Rule That Must Not Change

```text
LLM
 ↓
structured understanding / plan
 ↓
deterministic runtime
 ↓
tool / MCP
 ↓
validation
```

The project discussion explicitly settled on:

> LLMs think. Runtime executes.

Source: `Memory Saved for Future.txt`. fileciteturn113file4L826-L847

---

# What NOT To Do Next

Do not:
- add random agents
- create another orchestrator
- create another scheduler
- make GUI automation the default execution path
- call every existing module "complete"
- jump to proactive autonomy before reliability
- replace the roadmap numbering again without an explicit roadmap decision

The project's own rules say:

```text
Never overbuild early.
Infrastructure before flashy features.
```

Source: `Memory Saved for Future.txt`. fileciteturn113file1L329-L358
