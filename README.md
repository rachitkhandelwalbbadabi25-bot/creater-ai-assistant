# 🤖 Creater AI Assistant

> A local-first, proactive, emotionally intelligent AI assistant with Hinglish support, deep persistent memory, multi-agent orchestration, and full laptop control.

![Bun](https://img.shields.io/badge/runtime-Bun-f9a8d4?style=flat-square)
![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?style=flat-square)
![Ollama](https://img.shields.io/badge/LLM-Ollama-white?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

---

## ✨ What is Creater?

Creater is a **deeply personal AI assistant** that runs entirely on your machine. He feels like a close, intelligent Indian friend who:

- 🧠 **Remembers everything** — 3-tier memory (short/mid/long-term) + semantic vector search
- 💛 **Understands your mood** — Hybrid emotion detection (Hinglish keywords + ML)
- ⚡ **Acts proactively** — Morning briefings, deadline alerts, night check-ins
- 🖥️ **Controls your laptop** — Shell commands, file ops, browser automation, VS Code, Git
- 🗣️ **Speaks Hinglish** — Natural Hindi + English mix with Indian cultural context
- 🔒 **Stays private** — Everything runs locally, no data leaves your machine
- 🧬 **Evolves over time** — Learns your patterns and auto-generates reusable skills

---

## 🏗️ Architecture

```
User Input (TUI / Telegram / Voice)
        │
        ▼
  ┌─────────────┐
  │   Router     │ ← Intent classification (fast model)
  │  + Emotion   │ ← Hybrid mood detection
  │  + Memory    │ ← RAG retrieval (vector + SQLite)
  └──────┬──────┘
         │
    ┌────┴────┐
    ▼         ▼
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│Task  │ │Emot. │ │Laptop│ │Proj. │ │Skill │
│Agent │ │Agent │ │Agent │ │Agent │ │Agent │
└──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘ └──┬───┘
   └────────┴────────┴────────┴────────┘
                     │
              ┌──────┴──────┐
              │  Supervisor  │ → Response
              └─────────────┘
```

### Model Strategy (Local Optimized)
| Task Type | Model | Why |
|-----------|-------|-----|
| Reasoning & Routing | `qwen2.5-coder:7b` | High reasoning, fast locally |
| Code & Execution | `qwen2.5-coder:7b` | Code-optimized |
| Embeddings (memory) | `nomic-embed-text` | Efficient vectors |

---

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh) >= 1.1.0
- [Ollama](https://ollama.ai) running locally

### 1. Install Dependencies
```bash
bun install
```

### 2. Pull Required Models
```bash
ollama pull qwen2.5-coder:7b
ollama pull nomic-embed-text
```

### 3. Run Diagnostic (Recommended)
Check if your system is ready:
```bash
bun run diagnostic.ts
```

### 4. Run
```bash
# Start Creater in terminal
bun run dev

# Or start the TUI directly
bun run tui
```

---

## 📁 Project Structure

```
src/
├── index.ts                    # Main entry — bootstrap sequence
├── config/                     # Configuration, models, tool registry
├── llm/                        # Ollama client, model router, prompts
├── memory/                     # 3-tier memory + vector store + RAG
├── emotion/                    # Hybrid emotion detection + learning
├── graph/                      # Multi-agent system (supervisor + agents)
├── tools/                      # Laptop control (shell, fs, browser, git)
├── proactive/                  # Scheduled briefings, alerts, check-ins
├── voice/                      # Speech-to-text (Whisper) + TTS (Piper)
├── skills/                     # Self-evolving skill system
├── tui/                        # Terminal UI (Ink + React)
├── bot/                        # Telegram bot (Grammy)
├── web/                        # Web dashboard (future)
└── utils/                      # Logger, errors, helpers, context builder
```

---

## 🔧 Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start with hot reload |
| `bun run start` | Production start |
| `bun run tui` | Launch terminal UI |
| `bun run test` | Run tests |
| `bun run typecheck` | TypeScript type checking |
| `bun run docker:up` | Start Ollama via Docker |

---

## 🛡️ Safety

Creater has a multi-layered safety system:

- **Blocked commands** — `rm -rf /`, `format`, fork bombs are always denied
- **Suspicious patterns** — `sudo`, `chmod 777`, piped curls require confirmation
- **Permission levels** — Each tool has safe/moderate/sensitive/dangerous rating
- **Safety modes** — Strict (default), Moderate, Permissive
- **Protected paths** — System directories, `.ssh`, `.env` are guarded

---

## 🤝 Contributing

This is a personal project, but PRs and ideas are welcome!

---

## 📜 License

MIT — Build your own Creater!
