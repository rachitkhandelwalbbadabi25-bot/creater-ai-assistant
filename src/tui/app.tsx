// ════════════════════════════════════════════════════════════════════════════════
// src/tui/app.tsx — Terminal UI using Ink (React for the terminal)
// ════════════════════════════════════════════════════════════════════════════════

import React, { useState, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import Spinner from "ink-spinner";
import { processMessage } from "@graph/supervisor.js";
import { env } from "@config/index.js";
import gradient from "gradient-string";
import figlet from "figlet";

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
    setMessages((prev: ChatEntry[]) => [...prev, { role: "user", content: trimmed, timestamp: new Date() }]);
    setInput("");
    setIsThinking(true);

    try {
      const response = await processMessage(trimmed, "tui");
      setMessages((prev: ChatEntry[]) => [...prev, { role: "assistant", content: response, timestamp: new Date() }]);
    } catch {
      setMessages((prev: ChatEntry[]) => [...prev, {
        role: "assistant",
        content: "😅 Kuch galat ho gaya. Please try again!",
        timestamp: new Date(),
      }]);
    } finally {
      setIsThinking(false);
    }
  }, [exit]);

  // Global key bindings
  useInput((input: string, key: any) => {
    if (key.ctrl && input === "c") exit();
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="magenta" bold>
          ✨ Creater AI Assistant
        </Text>
        <Text color="gray"> — Type "exit" to quit</Text>
      </Box>

      {/* Chat Messages */}
      <Box flexDirection="column" marginBottom={1}>
        {messages.slice(-15).map((msg: ChatEntry, i: number) => (
          <Box key={i} marginBottom={0}>
            <Text color={msg.role === "user" ? "cyan" : msg.role === "system" ? "yellow" : "green"}>
              {msg.role === "user" ? `${env.USER_NAME}` : msg.role === "system" ? "📢 System" : "🤖 Creater"}
            </Text>
            <Text>: {msg.content}</Text>
          </Box>
        ))}
      </Box>

      {/* Thinking indicator */}
      {isThinking && (
        <Box marginBottom={1}>
          <Text color="yellow">
            <Spinner type="dots" /> Creater soch raha hai...
          </Text>
        </Box>
      )}

      {/* Input */}
      {!isThinking && (
        <Box>
          <Text color="cyan" bold>{`${env.USER_NAME} › `}</Text>
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
        </Box>
      )}
    </Box>
  );
}

// ─── Entry Point ──────────────────────────────────────────────────────────────────
export function startTUI(): void {
  // Show splash banner
  try {
    const banner = figlet.textSync("Creater", { font: "Small" });
    console.log(gradient.pastel.multiline(banner));
    console.log(gradient.cristal("  Your Personal AI Assistant\n"));
  } catch {
    console.log("\n  ✨ Creater — Your Personal AI Assistant\n");
  }

  render(<CreaterApp />);
}

// Run directly if executed as main
if ((import.meta as any).main) {
  startTUI();
}
