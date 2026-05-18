"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import ChatInterface from "@/components/ChatInterface";
import MemoryExplorer from "@/components/MemoryExplorer";
import Analytics from "@/components/Analytics";
import Settings from "@/components/Settings";

import { env } from "@config/index";

export default function Home() {
  const [activeTab, setActiveTab] = useState("Chat");
  const [messages, setMessages] = useState<any[]>([
    {
      id: "1",
      role: "assistant",
      content: "👋 Hello! Main Creater hoon. Aaj hum kya banayenge?",
      timestamp: new Date(),
    },
  ]);

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
