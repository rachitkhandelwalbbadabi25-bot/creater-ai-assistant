// ════════════════════════════════════════════════════════════════════════════════
// src/tui/app.tsx — Terminal UI using Ink (React for the terminal)
// ════════════════════════════════════════════════════════════════════════════════

import React, { useState, useCallback, useEffect } from "react";
import { render, Box, Text, useInput, useApp, Newline, Static, Transform } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { processMessage } from "@graph/supervisor.js";
import { env } from "@config/index.js";
import { AvailableModels, ProviderAvailability, Models } from "@config/models.js";
import { setModelOverride, getModelOverride } from "@llm/router.js";
import { getAllFacts } from "@memory/longTerm.js";
import { getTopNodes, getGraphStats, getNodeWithEdges } from "@memory/graph.js";
import { getAppStats, type AppStats } from "@utils/stats.js";
import gradient from "gradient-string";
import figlet from "figlet";
import dayjs from "dayjs";
import { voiceEvents } from "@voice/wakeWord.js";

// ─── Types ────────────────────────────────────────────────────────────────────────
interface ChatEntry {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

// ─── System Metrics Component ───────────────────────────────────────────────────
function SystemMetrics() {
  const [metrics, setMetrics] = useState({ cpu: 0, ram: 0, battery: 0 });

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const { getSystemInfo } = await import("@tools/laptop/system.js");
        const info = await getSystemInfo();
        setMetrics({
          cpu: info.cpu.usage,
          ram: info.ram.usagePercent,
          battery: info.battery?.percent ?? 100,
        });
      } catch (e) {}
    };
    fetchMetrics();
    const timer = setInterval(fetchMetrics, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box>
      <Text color="gray"> [ </Text>
      <Text color={metrics.cpu > 70 ? "red" : "green"}>CPU: {metrics.cpu}%</Text>
      <Text color="gray"> | </Text>
      <Text color={metrics.ram > 80 ? "red" : "blue"}>RAM: {metrics.ram}%</Text>
      <Text color="gray"> | </Text>
      <Text color={metrics.battery < 20 ? "red" : "yellow"}>BAT: {metrics.battery}%</Text>
      <Text color="gray"> ]</Text>
    </Box>
  );
}

// ─── Main App Component ──────────────────────────────────────────────────────────
function CreaterApp() {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatEntry[]>([
    {
      role: "system",
      content: `👋 Hey ${env.USER_NAME}! Main Creater hoon — tumhara personal AI assistant. Kuch bhi poocho!`,
      timestamp: new Date(),
    },
  ]);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessingSpeech, setIsProcessingSpeech] = useState(false);
  const [listeningTimeLeft, setListeningTimeLeft] = useState(15);
  const [stats, setStats] = useState<AppStats>({
    messageCount: 0,
    factCount: 0,
    taskCount: 0,
    lastMood: "Neutral",
  });

  // Countdown Timer for Voice
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isListening) {
      setListeningTimeLeft(15);
      interval = setInterval(() => {
        setListeningTimeLeft(prev => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isListening]);

  // Refresh stats periodically
  useEffect(() => {
    const refresh = () => setStats(getAppStats());
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);


  // Handle message submission
  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (["exit", "quit", "bye"].includes(trimmed.toLowerCase())) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "👋 Bye bye! Take care yaar. 💛",
        timestamp: new Date(),
      }]);
      setTimeout(() => exit(), 1000);
      return;
    }

    if (trimmed.toLowerCase().startsWith("/voice ")) {
      const state = trimmed.split(" ")[1];
      if (state === "on") {
        import("@voice/wakeWord.js").then(m => m.startWakeWordDetection(() => {}));
        setMessages(prev => [...prev, { role: "assistant", content: "🎙️ Voice detection started.", timestamp: new Date() }]);
      } else if (state === "off") {
        import("@voice/wakeWord.js").then(m => m.stopWakeWordDetection());
        setMessages(prev => [...prev, { role: "assistant", content: "🔇 Voice detection stopped.", timestamp: new Date() }]);
      }
      setInput("");
      return;
    }

    if (trimmed.toLowerCase() === "/models") {
      const currentOverride = getModelOverride();
      
      const providers = [
        { name: "Anthropic", key: "anthropic" },
        { name: "OpenAI", key: "openai" },
        { name: "DeepSeek", key: "deepseek" },
        { name: "Gemini", key: "gemini" },
        { name: "Grok", key: "grok" },
      ];

      const lines = [
        "🤖 **CREATER MODEL STATUS & OVERRIDES**",
        "══════════════════════════════════════════════════",
        "🌐 **CLOUD PROVIDERS:**"
      ];

      for (const prov of providers) {
        const isConfigured = (ProviderAvailability as any)[prov.key];
        const statusText = isConfigured ? "🟢 Configured" : "🔴 Not Configured";
        lines.push(`  • **${prov.name}** ─── [${statusText}]`);
        
        // Find models for this provider
        const models = Object.values(AvailableModels).filter(m => m.provider === prov.key);
        for (const m of models) {
          const isActive = currentOverride === m.id || (!currentOverride && env.DEFAULT_MODEL === m.id);
          const activeMarker = isActive ? " ➔ **ACTIVE**" : "";
          lines.push(`    - ${m.id} (${m.type})${activeMarker}`);
        }
      }

      lines.push("");
      lines.push("💻 **LOCAL PROVIDERS:**");
      lines.push("  • **Ollama** ─── [🟢 Connected]");
      const localModels = Object.values(AvailableModels).filter(m => m.provider === "ollama");
      for (const m of localModels) {
        const isActive = currentOverride === m.id || (!currentOverride && env.DEFAULT_MODEL === m.id);
        const activeMarker = isActive ? " ➔ **ACTIVE**" : "";
        lines.push(`    - ${m.id} (${m.type})${activeMarker}`);
      }

      lines.push("══════════════════════════════════════════════════");
      lines.push("⚙️ **ROUTING CONFIGURATION:**");
      lines.push(`  • LLM Provider: ${env.LLM_PROVIDER}`);
      lines.push(`  • Global Override: ${currentOverride ? `**${currentOverride}**` : "*None (Auto-Routing)*"}`);
      
      const primaryModel = env.DEFAULT_MODEL || Models.PRIMARY;
      lines.push(`  • Active Primary Model: **${primaryModel}**`);
      lines.push("");
      lines.push("Type `/model <id>` to force a model, or `/model auto` to clear.");

      setMessages(prev => [...prev, {
        role: "assistant",
        content: lines.join("\n"),
        timestamp: new Date()
      }]);
      setInput("");
      return;
    }

    if (trimmed.toLowerCase().startsWith("/model ")) {
      const targetModel = trimmed.split(" ")[1];
      if (targetModel === "auto" || targetModel === "none") {
        setModelOverride(null);
        setMessages(prev => [...prev, { role: "assistant", content: "🤖 Model override cleared. Auto-routing is now ACTIVE.", timestamp: new Date() }]);
      } else if (AvailableModels[targetModel]) {
        setModelOverride(targetModel);
        setMessages(prev => [...prev, { role: "assistant", content: `🤖 Model override set to: **${targetModel}**`, timestamp: new Date() }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: `❌ Unknown model: ${targetModel}. Type \`/models\` to see the list.`, timestamp: new Date() }]);
      }
      setInput("");
      return;
    }

    if (trimmed.toLowerCase() === "/facts") {
      const allFacts = getAllFacts();
      if (allFacts.length === 0) {
        setMessages(prev => [...prev, { role: "assistant", content: "🧠 No facts stored yet. Chat more and I'll learn about you!", timestamp: new Date() }]);
      } else {
        const grouped = new Map<string, typeof allFacts>();
        for (const f of allFacts) {
          const arr = grouped.get(f.category) ?? [];
          arr.push(f);
          grouped.set(f.category, arr);
        }
        const lines: string[] = ["🧠 **Your Knowledge Base:**\n"];
        for (const [cat, facts] of grouped) {
          lines.push(`📂 ${cat.toUpperCase()}`);
          for (const f of facts.slice(0, 8)) {
            lines.push(`  • ${f.key}: ${f.value}`);
          }
        }
        lines.push(`\n📊 Total: ${allFacts.length} facts stored`);
        setMessages(prev => [...prev, { role: "assistant", content: lines.join("\n"), timestamp: new Date() }]);
      }
      setInput("");
      return;
    }

    if (trimmed.toLowerCase() === "/graph") {
      const stats = getGraphStats();
      const topNodes = getTopNodes(8);
      const lines: string[] = [
        `🕸️ **Memory Graph** — ${stats.nodeCount} nodes · ${stats.edgeCount} edges · ${stats.archivedCount} archived\n`,
      ];
      for (const node of topNodes) {
        const withEdges = getNodeWithEdges(node.label);
        if (withEdges && withEdges.edges.length > 0) {
          const edgeStr = withEdges.edges.slice(0, 3).map(e => `${e.relation}→${e.target.label}`).join(", ");
          lines.push(`  [${node.type}] ${node.label}  ──  ${edgeStr}`);
        } else {
          lines.push(`  [${node.type}] ${node.label}`);
        }
      }
      if (topNodes.length === 0) lines.push("  No graph nodes yet. Facts will auto-populate the graph.");
      setMessages(prev => [...prev, { role: "assistant", content: lines.join("\n"), timestamp: new Date() }]);
      setInput("");
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: trimmed, timestamp: new Date() }]);
    setInput("");
    setIsThinking(true);

    try {
      let streamingContent = "";
      setMessages((prev) => [...prev, { role: "assistant", content: "", timestamp: new Date() }]);

      const response = await processMessage(trimmed, "tui", (token) => {
        streamingContent += token;
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            last.content = streamingContent;
          }
          return updated;
        });
      });
      
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant") last.content = response;
        return updated;
      });
    } catch {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "😅 Kuch galat ho gaya. Please try again!",
        timestamp: new Date(),
      }]);
    } finally {
      setIsThinking(false);
      setStats(getAppStats());
    }
  }, [exit]);

  // Listen to voice events
  useEffect(() => {
    const handleTranscribed = (text: string) => {
      setIsProcessingSpeech(false);
      handleSubmit(text);
    };
    
    const handleWake = () => { setIsListening(true); setIsProcessingSpeech(false); };
    const handleIdle = () => { setIsListening(false); setIsProcessingSpeech(false); };
    const handleProcessing = () => { setIsListening(false); setIsProcessingSpeech(true); };

    voiceEvents.on("wake", handleWake);
    voiceEvents.on("idle", handleIdle);
    voiceEvents.on("processing_speech", handleProcessing);
    voiceEvents.on("transcribed", handleTranscribed);
    
    return () => {
      voiceEvents.off("wake", handleWake);
      voiceEvents.off("idle", handleIdle);
      voiceEvents.off("processing_speech", handleProcessing);
      voiceEvents.off("transcribed", handleTranscribed);
    };
  }, [handleSubmit]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") exit();
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} minHeight={20}>
      {/* ─── Header ────────────────────────────────────────────────────────── */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text bold color="cyan">✨ {env.APP_NAME.toUpperCase()}</Text>
          <Text color="gray"> | </Text>
          <Text color="magenta">{stats.lastMood}</Text>
        </Box>
        <SystemMetrics />
      </Box>

      {/* ─── Stats Bar ────────────────────────────────────────────────────── */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-around" marginBottom={1}>
        <Text color="yellow">👤 {env.USER_NAME}</Text>
        <Text color="green">📝 {stats.messageCount} Chats</Text>
        <Text color="blue">🧠 {stats.factCount} Facts</Text>
        <Text color="red">🎯 {stats.taskCount} Tasks</Text>
      </Box>

      {/* ─── Chat Window ──────────────────────────────────────────────────── */}
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="cyan" paddingX={1}>
        <Static items={messages}>
          {(msg: ChatEntry, i: number) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Box>
                <Text bold color={msg.role === "user" ? "magenta" : "cyan"}>
                  {msg.role === "user" ? "USER" : "CREATER"}
                </Text>
                <Text color="gray"> [{dayjs(msg.timestamp).format("HH:mm")}]</Text>
              </Box>
              <Box paddingLeft={2}>
                <Text color={msg.role === "user" ? "white" : "cyanBright"}>{msg.content}</Text>
              </Box>
              <Box marginTop={0}>
                <Text color="gray">{`─`.repeat(20)}</Text>
              </Box>
            </Box>
          )}
        </Static>
        
        {isThinking && (
          <Box marginLeft={1}>
            <Text color="yellow">
              <Spinner type="dots" /> <Text italic>Soch raha hoon...</Text>
            </Text>
          </Box>
        )}
        {isListening && (
          <Box marginLeft={1}>
            <Text color="greenBright" bold>
              <Spinner type="point" /> Listening for voice command... ({listeningTimeLeft}s)
            </Text>
          </Box>
        )}
        {isProcessingSpeech && (
          <Box marginLeft={1}>
            <Text color="yellowBright" bold>
              <Spinner type="earth" /> Transcribing audio (Local STT)...
            </Text>
          </Box>
        )}
      </Box>

      {/* ─── Input Area ───────────────────────────────────────────────────── */}
      <Box marginTop={1}>
        <Text color={isListening ? "greenBright" : "cyan"} bold>❯ </Text>
        <TextInput 
          value={input} 
          onChange={setInput} 
          onSubmit={handleSubmit} 
          placeholder={isListening ? "Speak now..." : "Type something here..."}
        />
      </Box>
      <Box>
        <Text color="gray" dimColor>Press Ctrl+C to Exit</Text>
      </Box>
    </Box>
  );
}

// ─── Entry Point ──────────────────────────────────────────────────────────────────
export function startTUI(): void {
  if (!process.stdin.isTTY && env.APP_ENV !== "test") {
    process.exit(1);
  }

  try {
    const banner = figlet.textSync("CREATER", { font: "Small" });
    console.clear();
    console.log(gradient(["cyan", "magenta"]).multiline(banner));
    console.log(gradient.cristal("  ════════════ Premium AI Experience ════════════\n"));
  } catch {
    console.log("\n  ✨ Creater — Your Personal AI Assistant\n");
  }

  render(<CreaterApp />);
}

if ((import.meta as any).main) {
  startTUI();
}
