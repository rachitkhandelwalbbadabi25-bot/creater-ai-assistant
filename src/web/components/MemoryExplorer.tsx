"use client";

import React, { useState, useEffect } from "react";
import { Search, Clock, Brain, Tag, Trash2, Filter, Loader2 } from "lucide-react";
import { getMemoriesAction } from "@/app/actions";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";

interface Memory {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  created_at: string;
}

export default function MemoryExplorer() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const fetchMemories = async (search?: string) => {
    setIsLoading(true);
    const res = await getMemoriesAction(search);
    if (res.success) {
      setMemories(res.data as Memory[]);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchMemories();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchMemories(query);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Brain className="text-purple-500" size={28} />
            Memory Explorer
          </h2>
          <p className="text-zinc-500 text-sm mt-1 font-medium uppercase tracking-widest">Long-term Knowledge Retrieval</p>
        </div>
        <button 
          onClick={() => fetchMemories()}
          className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-colors"
        >
          <Filter size={20} />
        </button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="relative group">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-cyan-500 transition-colors" size={20} />
        <input 
          type="text" 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search through memories..."
          className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3.5 pl-12 pr-4 text-zinc-200 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500/50 outline-none transition-all font-medium"
        />
        <button type="submit" className="hidden" />
      </form>

      {/* Memory List */}
      <div className="grid gap-4 overflow-y-auto pr-2 pb-8">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p className="font-bold uppercase tracking-widest text-xs">Retrieving Knowledge...</p>
          </div>
        ) : memories.length === 0 ? (
          <div className="text-center py-20 bg-zinc-900/20 rounded-3xl border border-dashed border-zinc-800">
            <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">No memories found</p>
          </div>
        ) : (
          memories.map((memory) => (
            <div 
              key={memory.id}
              className="group relative bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 hover:bg-zinc-900 hover:border-zinc-700 transition-all duration-300"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 bg-cyan-500/10 text-cyan-400 text-[10px] font-bold uppercase tracking-widest rounded-full border border-cyan-500/20">
                    {memory.category}
                  </span>
                  <span className="flex items-center gap-1.5 text-zinc-500 text-[11px] font-bold uppercase tracking-widest ml-2">
                    <Clock size={12} />
                    {dayjs(memory.created_at).format("MMM D, HH:mm")}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em]">{memory.key}</p>
                <p className="text-zinc-300 leading-relaxed font-medium">
                  {memory.value}
                </p>
              </div>
              
              {/* Confidence Indicator */}
              <div className="mt-4 flex gap-1">
                {[...Array(5)].map((_, i) => (
                  <div 
                    key={i} 
                    className={cn(
                      "h-1 w-6 rounded-full",
                      i < Math.round(memory.confidence * 5) ? "bg-cyan-500/50" : "bg-zinc-800"
                    )} 
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
