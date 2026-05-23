"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, User, Bot, Sparkles, Loader2 } from "lucide-react";
import { chatAction } from "@/app/actions";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function ChatInterface({ 
  appName = "Creater",
  messages,
  setMessages
}: { 
  appName?: string;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const isSubmittingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    let result;
    try {
      result = await chatAction(input);
    } finally {
      isSubmittingRef.current = false;
      setIsLoading(false);
    }

    if (result.success) {
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: result.response || "No response received",
        timestamp: new Date(),
      }]);
    } else {
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: result.error || "😅 Sorry, kuch error aa gaya. Please try again!",
        timestamp: new Date(),
      }]);
    }

  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <header className="px-8 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50 backdrop-blur-xl sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
          <h2 className="text-sm font-bold text-zinc-200 tracking-wide uppercase">Active Session</h2>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 rounded-full border border-zinc-800">
          <Sparkles size={14} className="text-yellow-500" />
          <span className="text-xs font-semibold text-zinc-400">GPT-4o Reasoning</span>
        </div>
      </header>

      {/* Messages */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-8 space-y-8 scroll-smooth"
      >
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={cn(
              "flex gap-4 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500",
              msg.role === "user" ? "flex-row-reverse" : "flex-row"
            )}
          >
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg",
              msg.role === "user" ? "bg-zinc-800" : "bg-cyan-600"
            )}>
              {msg.role === "user" ? <User size={20} className="text-zinc-400" /> : <Bot size={20} className="text-white" />}
            </div>
            
            <div className={cn(
              "flex flex-col gap-1.5",
              msg.role === "user" ? "items-end text-right" : "items-start"
            )}>
              <div className={cn(
                "px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm",
                msg.role === "user" 
                  ? "bg-zinc-800 text-zinc-200 rounded-tr-none border border-zinc-700" 
                  : "bg-zinc-900 text-zinc-200 rounded-tl-none border border-zinc-800"
              )}>
                {msg.content}
              </div>
              <span suppressHydrationWarning className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-1">
                {dayjs(msg.timestamp).format("HH:mm")}
              </span>
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex gap-4 max-w-4xl mx-auto animate-pulse">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center">
              <Loader2 className="text-zinc-700 animate-spin" size={20} />
            </div>
            <div className="bg-zinc-900/50 h-12 w-32 rounded-2xl rounded-tl-none border border-zinc-800" />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-8 pt-0 max-w-5xl mx-auto w-full">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-2xl blur opacity-25 group-focus-within:opacity-50 transition duration-1000 group-hover:duration-200"></div>
          <div className="relative flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-2 shadow-2xl">
            <input 
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Ask me anything..."
              className="flex-1 bg-transparent border-none focus:ring-0 text-zinc-200 px-4 py-3 placeholder:text-zinc-600 font-medium"
            />
            <button 
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="p-3 bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-xl transition-all duration-200 shadow-lg shadow-cyan-500/20"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
        <p className="text-center mt-4 text-[11px] font-bold text-zinc-600 uppercase tracking-[0.2em]">
          Powered by Local Reasoning Engine • {appName}
        </p>
      </div>
    </div>
  );
}
