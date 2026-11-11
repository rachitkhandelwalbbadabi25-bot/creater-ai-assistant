"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import ChatInterface from "@/components/ChatInterface";
import MemoryExplorer from "@/components/MemoryExplorer";
import Analytics from "@/components/Analytics";
import Settings from "@/components/Settings";

const DEFAULT_MESSAGE = {
  id: "welcome",
  role: "assistant" as const,
  content: "👋 Hey! Main Creater hoon — tumhara personal AI assistant. Kuch bhi poocho!",
  timestamp: new Date().toISOString(),
};

export default function Home() {
  const [activeTab, setActiveTab] = useState("Chat");
  const [messages, setMessages] = useState<any[]>([DEFAULT_MESSAGE]);
  const [mounted, setMounted] = useState(false);

  // Synchronize from localStorage only after client-side mount to guarantee matching SSR HTML
  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem("creater_chat_history");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch (err) {
      console.error("Failed to load initial chat history:", err);
    }
  }, []);

  // Save to localStorage when messages change (debounced to avoid blocking during streaming)
  useEffect(() => {
    if (!mounted || messages.length <= 1) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem("creater_chat_history", JSON.stringify(messages.slice(-50)));
      } catch (err) {
        console.error("Failed to save chat history:", err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [messages, mounted]);

  return (
    <main className="flex min-h-screen bg-zinc-950 text-zinc-200 selection:bg-cyan-500/30">
      {/* Sidebar with tab control */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      {/* Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {activeTab === "Chat" && <ChatInterface appName="Creater" messages={messages} setMessages={setMessages} />}
        {activeTab === "Memory" && <MemoryExplorer />}
        {activeTab === "Analytics" && <Analytics />}
        {activeTab === "Settings" && <Settings />}
      </div>
    </main>
  );
}


