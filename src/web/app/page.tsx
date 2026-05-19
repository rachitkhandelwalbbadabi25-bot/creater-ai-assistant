"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import ChatInterface from "@/components/ChatInterface";
import MemoryExplorer from "@/components/MemoryExplorer";
import Analytics from "@/components/Analytics";
import Settings from "@/components/Settings";

import { env } from "@config/index";

export default function Home() {
  const [activeTab, setActiveTab] = useState("Chat");

  const defaultWelcomeMessage = {
    id: "1",
    role: "assistant",
    content: "👋 Hello! Main Creater hoon. Aaj hum kya banayenge?",
    timestamp: new Date(),
  };

  const [messages, setMessages] = useState<any[]>(() => {
    if (typeof window === 'undefined') return [defaultWelcomeMessage];
    try {
      const saved = localStorage.getItem('creater_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
      }
      return [defaultWelcomeMessage];
    } catch { 
      return [defaultWelcomeMessage]; 
    }
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && messages.length > 1) {
      localStorage.setItem('creater_chat_history', JSON.stringify(messages.slice(-50)));
    }
  }, [messages]);

  return (
    <main className="flex min-h-screen bg-zinc-950 text-zinc-200 selection:bg-cyan-500/30">
      {/* Sidebar with tab control */}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      {/* Content Area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {activeTab === "Chat" && <ChatInterface appName={env.APP_NAME} messages={messages} setMessages={setMessages} />}
        {activeTab === "Memory" && <MemoryExplorer />}
        {activeTab === "Analytics" && <Analytics />}
        {activeTab === "Settings" && <Settings />}
      </div>
    </main>
  );
}
