"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import ChatInterface from "@/components/ChatInterface";
import MemoryExplorer from "@/components/MemoryExplorer";
import Analytics from "@/components/Analytics";
import Settings from "@/components/Settings";

export default function Home() {
  const [activeTab, setActiveTab] = useState("Chat");

  const defaultMessage = {
    id: "welcome",
    role: "assistant" as const,
    content: "👋 Hey! Main Creater hoon — tumhara personal AI assistant. Kuch bhi poocho!",
    timestamp: new Date().toISOString(),
  };

  // Start with just welcome message (works on server too)
  const [messages, setMessages] = useState<any[]>([defaultMessage]);
  const [mounted, setMounted] = useState(false);

  // Load from localStorage only after mount (client-side only)
  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem('creater_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.length > 0) {
          setMessages(parsed);
        }
      }
    } catch { }
  }, []);

  // Save to localStorage on every message change
  useEffect(() => {
    if (mounted && messages.length > 1) {
      localStorage.setItem('creater_chat_history', JSON.stringify(messages.slice(-50)));
    }
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
