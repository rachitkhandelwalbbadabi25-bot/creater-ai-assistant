"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Search, Brain, GitBranch, Layers, Archive, BarChart3, Loader2, X } from "lucide-react";
import { getMemoriesAction, getGraphAction } from "@/app/actions";
import ForceDirectedGraph from "./ForceDirectedGraph";
import { cn } from "@/lib/utils";
import dayjs from "dayjs";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Memory {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  created_at: string;
}

interface GraphNode {
  id: string;
  type: string;
  label: string;
  description: string | null;
  importance: number;
  access_count: number;
  tags: string[];
  edges: Array<{ relation: string; weight: number; target: { label: string; type: string } }>;
}

interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  archivedCount: number;
}

type Tab = "facts" | "graph";

const NODE_TYPE_ICONS: Record<string, string> = {
  person: "👤", preference: "✨", project: "🚀", habit: "🔄",
  topic: "📌", skill: "⚡", tool: "🛠️", emotion: "💭",
};

const RELATION_COLORS: Record<string, string> = {
  likes: "text-rose-400", prefers: "text-cyan-400", uses: "text-blue-400",
  works_on: "text-amber-400", knows: "text-violet-400", has_habit: "text-emerald-400",
  related_to: "text-zinc-400", learned: "text-pink-400", avoids: "text-red-400",
};

// ─── Main Component ─────────────────────────────────────────────────────────────
export default function MemoryExplorer() {
  const [tab, setTab] = useState<Tab>("facts");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [stats, setStats] = useState<GraphStats>({ nodeCount: 0, edgeCount: 0, archivedCount: 0 });
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const fetchFacts = async (search?: string) => {
    setIsLoading(true);
    const res = await getMemoriesAction(search);
    if (res.success) setMemories(res.data as Memory[]);
    setIsLoading(false);
  };

  const fetchGraph = async (search?: string) => {
    setIsLoading(true);
    const res = await getGraphAction(search);
    if (res.success) {
      setNodes((res.data as any).nodes ?? []);
      setStats((res.data as any).stats ?? { nodeCount: 0, edgeCount: 0, archivedCount: 0 });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (tab === "facts") fetchFacts();
    else fetchGraph();
  }, [tab]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === "facts") fetchFacts(query);
    else fetchGraph(query);
  };

  const graphVisualData = useMemo(() => {
    const visualNodes = nodes.map(n => ({ id: n.id, label: n.label, type: n.type }));
    const visualEdges: any[] = [];
    nodes.forEach(n => {
      n.edges.forEach(e => {
        const targetNode = nodes.find(tn => tn.label === e.target.label);
        if (targetNode) {
          visualEdges.push({ source: n.id, target: targetNode.id, relation: e.relation });
        }
      });
    });
    return { nodes: visualNodes, edges: visualEdges };
  }, [nodes]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 p-8 space-y-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Brain className="text-purple-500" size={28} />
            Memory & Knowledge
          </h2>
          <p className="text-zinc-500 text-sm mt-1 font-medium uppercase tracking-widest">
            Advanced Knowledge Architecture
          </p>
        </div>

        <div className="flex items-center gap-3">
          <StatBadge icon={<Layers size={13} />} label="Facts" value={memories.length} color="cyan" />
          <StatBadge icon={<GitBranch size={13} />} label="Nodes" value={stats.nodeCount} color="violet" />
          <StatBadge icon={<BarChart3 size={13} />} label="Edges" value={stats.edgeCount} color="amber" />
        </div>
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col md:flex-row gap-4 items-center shrink-0">
        <div className="flex gap-1 p-1 bg-zinc-900/80 border border-zinc-800 rounded-2xl w-fit">
          {(["facts", "graph"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-5 py-2 rounded-xl text-sm font-bold uppercase tracking-widest transition-all",
                tab === t ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {t === "facts" ? "📚 Facts" : "🕸️ Graph"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="relative flex-1 group w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${tab === "facts" ? "facts & preferences" : "knowledge graph"}…`}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-11 pr-4 text-zinc-200 outline-none focus:ring-2 focus:ring-cyan-500/20 font-medium text-sm"
          />
        </form>
      </div>

      {/* Content Area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <Loader2 className="animate-spin text-cyan-500" size={32} />
            <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">Accessing Neural Map...</p>
          </div>
        ) : tab === "facts" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto h-full pr-2">
            {memories.map(m => (
              <div key={m.id} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-all">
                <div className="flex justify-between items-start mb-2">
                   <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{m.category}</span>
                   <span className="text-[10px] text-zinc-600">{dayjs(m.created_at).format("MMM D")}</span>
                </div>
                <p className="text-zinc-400 text-xs font-bold uppercase mb-1">{m.key}</p>
                <p className="text-white font-medium">{m.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6 h-full">
            {/* Visual View */}
            <div className="flex-1 bg-zinc-900/30 rounded-3xl border border-zinc-900 overflow-hidden relative">
              <ForceDirectedGraph 
                nodes={graphVisualData.nodes} 
                edges={graphVisualData.edges}
                onNodeClick={(label) => {
                  const n = nodes.find(node => node.label === label);
                  if (n) setSelectedNode(n);
                }}
                selectedNodeLabel={selectedNode?.label ?? null}
              />
            </div>

            {/* Sidebar / Details */}
            <div className="w-full lg:w-96 flex flex-col gap-4 overflow-hidden">
              {selectedNode ? (
                <div className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-6 overflow-y-auto">
                  <div className="flex justify-between items-start mb-4">
                    <span className="text-2xl">{NODE_TYPE_ICONS[selectedNode.type] || "📌"}</span>
                    <button onClick={() => setSelectedNode(null)} className="text-zinc-600 hover:text-white"><X size={18}/></button>
                  </div>
                  <h3 className="text-xl font-bold text-white">{selectedNode.label}</h3>
                  <p className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] mb-4">{selectedNode.type}</p>
                  
                  {selectedNode.description && (
                    <p className="text-zinc-400 text-sm mb-4 leading-relaxed">{selectedNode.description}</p>
                  )}

                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-2">Connections</p>
                      <div className="space-y-2">
                        {selectedNode.edges.map((e, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className={cn("font-bold uppercase tracking-tighter", RELATION_COLORS[e.relation] || "text-zinc-500")}>{e.relation}</span>
                            <span className="text-zinc-600">→</span>
                            <span className="text-zinc-200 font-bold">{e.target.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-900/30 border border-zinc-800 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center text-center">
                  <GitBranch className="text-zinc-700 mb-2" size={32} />
                  <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px]">Select a node to explore connections</p>
                </div>
              )}

              <div className="flex-1 overflow-y-auto pr-2 space-y-2">
                <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest px-2">Knowledge List</p>
                {nodes.map(n => (
                  <div 
                    key={n.id}
                    onClick={() => setSelectedNode(n)}
                    className={cn(
                      "p-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3",
                      selectedNode?.id === n.id ? "bg-zinc-800 border-zinc-700" : "bg-zinc-900/30 border-zinc-900 hover:border-zinc-800"
                    )}
                  >
                    <span className="text-sm">{NODE_TYPE_ICONS[n.type] || "📌"}</span>
                    <span className="text-sm font-bold text-zinc-300">{n.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBadge({ icon, label, value, color }: { icon: any, label: string, value: number, color: string }) {
  const colors: Record<string, string> = {
    cyan: "text-cyan-400 bg-cyan-400/10 border-cyan-400/20",
    violet: "text-violet-400 bg-violet-400/10 border-violet-400/20",
    amber: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  };
  return (
    <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest", colors[color])}>
      {icon} <span>{value}</span> <span className="opacity-50">{label}</span>
    </div>
  );
}
