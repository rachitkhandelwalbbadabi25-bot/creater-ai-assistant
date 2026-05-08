// ════════════════════════════════════════════════════════════════════════════════
// src/tui/app.tsx — Terminal UI using Ink (React for the terminal)
// ════════════════════════════════════════════════════════════════════════════════

import React, { useState, useCallback, useEffect } from "react";
import { render, Box, Text, useInput, useApp, Newline, Static } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { processMessage } from "@graph/supervisor.js";
import { env } from "@config/index.js";
import { getAppStats, type AppStats } from "@utils/stats.js";
import gradient from "gradient-string";
import figlet from "figlet";
import dayjs from "dayjs";

// ─── Types ────────────────────────────────────────────────────────────────────────
interface ChatEntry {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
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
  const [stats, setStats] = useState<AppStats>({
    messageCount: 0,
    factCount: 0,
    taskCount: 0,
    lastMood: "Initializing",
  });

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

    // Check for exit commands
    if (["exit", "quit", "bye", "chal bye"].includes(trimmed.toLowerCase())) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "👋 Bye bye! Take care yaar. Jab zaroorat ho, main hoon! 💛",
        timestamp: new Date(),
      }]);
      setTimeout(() => exit(), 1500);
      return;
    }

    // Add user message
    setMessages((prev) => [...prev, { role: "user", content: trimmed, timestamp: new Date() }]);
    setInput("");
    setIsThinking(true);

    try {
      let streamingContent = "";
      
      // Temporary entry for streaming response
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
      
      // Final update to ensure consistency
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant") {
          last.content = response;
        }
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
      setStats(getAppStats()); // Refresh stats after interaction
    }
  }, [exit]);

  // Global key bindings
  useInput((input, key) => {
    if (key.ctrl && input === "c") exit();
  });

  return (
    <Box flexDirection="column" padding={1} minHeight={15}>
      {/* ─── Header & Status ────────────────────────────────────────────────── */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold color="cyan">✨ CREATER AI ASSISTANT</Text>
          <Text color="gray">v0.2.0 | Bun 1.3 | Ctrl+C to Exit</Text>
        </Box>
        <Box marginTop={0}>
          <Text color="yellow">👤 {env.USER_NAME}</Text>
          <Text color="gray"> | </Text>
          <Text color="green">📚 {stats.factCount} Facts</Text>
          <Text color="gray"> | </Text>
          <Text color="blue">📋 {stats.taskCount} Tasks</Text>
          <Text color="gray"> | </Text>
          <Text color="magenta">🎭 {stats.lastMood.toUpperCase()}</Text>
        </Box>
      </Box>

      <Newline />

      {/* ─── Chat History ──────────────────────────────────────────────────── */}
      <Box flexDirection="column" flexGrow={1} marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Static items={messages}>
          {(msg: ChatEntry, i: number) => (
            <Box key={i} marginBottom={1} flexDirection="column">
              <Box>
                <Text bold color={msg.role === "user" ? "white" : "cyan"}>
                  {msg.role === "user" ? `👤 ${env.USER_NAME}` : "🤖 CREATER"}
                </Text>
                <Text color="gray"> • {dayjs(msg.timestamp).format("HH:mm")}</Text>
              </Box>
              <Box paddingLeft={2}>
                <Text>{msg.content}</Text>
              </Box>
            </Box>
          )}
        </Static>
        
        {isThinking && (
          <Box marginLeft={1} marginTop={1}>
            <Text color="yellow">
              <Spinner type="dots" /> <Text italic>Creater soch raha hai...</Text>
            </Text>
          </Box>
        )}
      </Box>

      {/* ─── Input Box ─────────────────────────────────────────────────────── */}
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text color="cyan" bold>➜ </Text>
        <TextInput 
          value={input} 
          onChange={setInput} 
          onSubmit={handleSubmit} 
          placeholder="Apna sawaal pucho (e.g. 'How are you yaar?')"
        />
      </Box>
    </Box>
  );
}

// ─── Entry Point ──────────────────────────────────────────────────────────────────
export function startTUI(): void {
  // Check if we are in a TTY before starting
  if (!process.stdin.isTTY && env.APP_ENV !== "test") {
    console.error("❌ Error: Creater TUI requires an interactive terminal.");
    console.log("Tip: Try running in a real terminal, not a sub-shell or IDE output window.");
    process.exit(1);
  }

  // Show splash banner
  try {
    const banner = figlet.textSync("CREATER", { font: "Standard" });
    console.clear();
    console.log(gradient.pastel.multiline(banner));
    console.log(gradient.cristal("  ════════════ Your Personal AI Assistant ════════════\n"));
  } catch {
    console.log("\n  ✨ Creater — Your Personal AI Assistant\n");
  }

  render(<CreaterApp />);
}

// Run directly if executed as main
if ((import.meta as any).main) {
  startTUI();
}
