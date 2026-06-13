import React, { useState, useRef, useEffect } from "react";
import { Send, User, Bot, Sparkles, Loader2, RefreshCw } from "lucide-react";
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
  setMessages,
}: {
  appName?: string;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [statusText, setStatusText] = useState("Thinking...");
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  
  const isSubmittingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // Enable auto-scroll if the user is close to the bottom (within 150px)
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
    setShouldAutoScroll(isNearBottom);
  };

  // Scroll to bottom when messages or loading state changes (if auto-scroll is allowed)
  useEffect(() => {
    if (scrollRef.current && shouldAutoScroll) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, shouldAutoScroll]);

  // Helper for token streaming updates
  const handleStreaming = (assistantId: string) => (token: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantId ? { ...msg, content: msg.content + token } : msg
      )
    );
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };
    
    // Instantly append user message and clear input
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    setShouldAutoScroll(true);

    // Setup dynamic status texts
    setStatusText("Thinking...");
    const t1 = setTimeout(() => setStatusText("Executing..."), 2500);
    const t2 = setTimeout(() => setStatusText("Still working..."), 7500);

    // Placeholder assistant message
    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", timestamp: new Date() }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });

      if (!response.body) throw new Error("No stream in response");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        handleStreaming(assistantId)(chunk);
      }
    } catch (err) {
      // Replace placeholder with a graceful user-friendly error message
      const errMsg = err instanceof Error ? err.message : String(err);
      let friendlyError = "Something went wrong while processing the request.";
      if (errMsg.includes("browser") || errMsg.includes("Could not launch")) {
        friendlyError = "Could not launch requested browser.";
      } else if (errMsg.includes("app") || errMsg.includes("Unable to open")) {
        friendlyError = "Unable to open requested app.";
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: friendlyError }
            : msg
        )
      );
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
      isSubmittingRef.current = false;
      setIsLoading(false);
    }
  };

  const handleClearHistory = () => {
    if (confirm("Are you sure you want to clear chat history?")) {
      const defaultMessage: Message = {
        id: "welcome",
        role: "assistant",
        content: "👋 Hey! Main Creater hoon — tumhara personal AI assistant. Kuch bhi poocho!",
        timestamp: new Date(),
      };
      setMessages([defaultMessage]);
      localStorage.removeItem("creater_chat_history");
    }
  };

  // Determine if loader spinner should be rendered at the bottom
  const showLoader = isLoading && (
    messages.length === 0 || 
    messages[messages.length - 1].role !== "assistant" || 
    messages[messages.length - 1].content === ""
  );

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <header className="px-8 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50 backdrop-blur-xl sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
          <h2 className="text-sm font-bold text-zinc-200 tracking-wide uppercase">Active Session</h2>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={handleClearHistory}
            className="flex items-center gap-1.5 px-3 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs font-semibold rounded-lg border border-zinc-800 transition-colors"
            title="Reset conversation session"
          >
            <RefreshCw size={12} />
            <span>Reset</span>
          </button>
          <div className="flex items-center gap-2 px-3 py-1 bg-zinc-900 rounded-full border border-zinc-800">
            <Sparkles size={14} className="text-yellow-500" />
            <span className="text-xs font-semibold text-zinc-400">GPT-4o Reasoning</span>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div 
        ref={scrollRef} 
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-8 space-y-8 scroll-smooth"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "flex gap-4 max-w-4xl mx-auto transition-all duration-300",
              msg.role === "user" ? "flex-row-reverse" : "flex-row"
            )}
          >
            <div
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-lg",
                msg.role === "user" ? "bg-zinc-800" : "bg-cyan-600"
              )}
            >
              {msg.role === "user" ? <User size={20} className="text-zinc-400" /> : <Bot size={20} className="text-white" />}
            </div>
            <div className={cn("flex flex-col gap-1.5 max-w-[85%]", msg.role === "user" ? "items-end text-right" : "items-start")}>
              <div
                className={cn(
                  "px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm whitespace-pre-wrap break-words",
                  msg.role === "user"
                    ? "bg-zinc-800 text-zinc-200 rounded-tr-none border border-zinc-700"
                    : "bg-zinc-900 text-zinc-200 rounded-tl-none border border-zinc-800"
                )}
              >
                {msg.content === "" && msg.role === "assistant" && isLoading ? (
                  <div className="flex items-center gap-2 text-zinc-500 italic">
                    <Loader2 className="animate-spin" size={14} />
                    <span>{statusText}</span>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
              <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest px-1 min-h-[15px]">
                {isMounted ? dayjs(msg.timestamp).format("HH:mm") : null}
              </span>
            </div>
          </div>
        ))}
        
        {showLoader && (
          <div className="flex gap-4 max-w-4xl mx-auto items-center animate-in fade-in duration-300">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center border border-zinc-800 shrink-0">
              <Loader2 className="text-cyan-500 animate-spin" size={18} />
            </div>
            <div className="bg-zinc-900/50 px-4 py-2.5 rounded-2xl rounded-tl-none border border-zinc-800 flex items-center gap-2">
              <span className="text-xs text-zinc-400 font-medium">{statusText}</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-8 pt-0 max-w-5xl mx-auto w-full">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-2xl blur opacity-25 group-focus-within:opacity-50 transition duration-1000 group-hover:duration-200" />
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
