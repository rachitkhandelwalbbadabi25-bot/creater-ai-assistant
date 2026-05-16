"use client";

import React, { useState, useEffect } from "react";
import { Search, Clock, Brain, Tag, Filter, Loader2, GitBranch, Layers, Archive, BarChart3 } from "lucide-react";
import { getMemoriesAction, getGraphAction } from "@/app/actions";
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

const NODE_TYPE_COLORS: Record<string, string> = {
  person:     "from-violet-500/20 to-violet-500/5 border-violet-500/30 text-violet-400",
  preference: "from-cyan-500/20   to-cyan-500/5   border-cyan-500/30   text-cyan-400",
  project:    "from-amber-500/20  to-amber-500/5  border-amber-500/30  text-amber-400",
  habit:      "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30 text-emerald-400",
  topic:      "from-zinc-500/20   to-zinc-500/5   border-zinc-600/30   text-zinc-400",
  skill:      "from-pink-500/20   to-pink-500/5   border-pink-500/30   text-pink-400",
  tool:       "from-blue-500/20   to-blue-500/5   border-blue-500/30   text-blue-400",
  emotion:    "from-rose-500/20   to-rose-500/5   border-rose-500/30   text-rose-400",
};

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

  return (
    <div className="flex flex-col h-full bg-zinc-950 p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Brain className="text-purple-500" size={28} />
            Memory & Knowledge
          </h2>
          <p className="text-zinc-500 text-sm mt-1 font-medium uppercase tracking-widest">
            Personal Knowledge Graph
          </p>
        </div>

        {/* Stats Row */}
        <div className="flex items-center gap-3">
          <StatBadge icon={<Layers size={13} />} label="Facts" value={memories.length} color="cyan" />
          <StatBadge icon={<GitBranch size={13} />} label="Nodes" value={stats.nodeCount} color="violet" />
          <StatBadge icon={<BarChart3 size={13} />} label="Edges" value={stats.edgeCount} color="amber" />
          <StatBadge icon={<Archive size={13} />} label="Archived" value={stats.archivedCount} color="zinc" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-zinc-900/80 border border-zinc-800 rounded-2xl w-fit">
        {(["facts", "graph"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-5 py-2 rounded-xl text-sm font-bold uppercase tracking-widest transition-all",
              tab === t
                ? "bg-zinc-800 text-white shadow-lg"
                : "text-zinc-500 hover:text-zinc-300"
            )}
          >
            {t === "facts" ? "📚 Facts" : "🕸️ Graph"}
          </button>
        ))}
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="relative group">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-cyan-500 transition-colors" size={18} />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={tab === "facts" ? "Search facts & preferences…" : "Search knowledge graph…"}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-3 pl-11 pr-4 text-zinc-200 focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500/50 outline-none transition-all font-medium text-sm"
        />
      </form>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
          <Loader2 className="animate-spin mb-4" size={32} />
          <p className="font-bold uppercase tracking-widest text-xs">Loading knowledge…</p>
        </div>
      ) : tab === "facts" ? (
        <FactsList memories={memories} />
      ) : (
        <GraphView
          nodes={nodes}
          selectedNode={selectedNode}
          onSelect={setSelectedNode}
        />
      )}
    </div>
  );
}

// ─── Facts List ─────────────────────────────────────────────────────────────────
function FactsList({ memories }: { memories: Memory[] }) {
  if (memories.length === 0)
    return (
      <div className="text-center py-20 bg-zinc-900/20 rounded-3xl border border-dashed border-zinc-800">
        <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">No facts yet — keep chatting!</p>
      </div>
    );

  const grouped = new Map<string, Memory[]>();
  for (const m of memories) {
    const arr = grouped.get(m.category) ?? [];
    arr.push(m);
    grouped.set(m.category, arr);
  }

  return (
    <div className="space-y-6 overflow-y-auto pr-2 pb-8">
      {[...grouped.entries()].map(([cat, facts]) => (
        <div key={cat}>
          <div className="flex items-center gap-2 mb-3 px-1">
            <Tag size={12} className="text-zinc-500" />
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.25em]">{cat}</span>
            <div className="flex-1 h-px bg-zinc-800" />
            <span className="text-[10px] text-zinc-600 font-bold">{facts.length}</span>
          </div>
          <div className="grid gap-3">
            {facts.map(memory => (
              <div
                key={memory.id}
                className="group bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 hover:bg-zinc-900 hover:border-zinc-700 transition-all"
              >
                <div className="flex justify-between items-start">
                  <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em]">{memory.key}</p>
                  <span className="flex items-center gap-1 text-zinc-600 text-[10px]">
                    <Clock size={10} />
                    {dayjs(memory.created_at).format("MMM D")}
                  </span>
                </div>
                <p className="text-zinc-200 font-medium mt-1 leading-relaxed">{memory.value}</p>
                <div className="mt-3 flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className={cn("h-0.5 w-5 rounded-full", i < Math.round(memory.confidence * 5) ? "bg-cyan-500/60" : "bg-zinc-800")}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Graph View ─────────────────────────────────────────────────────────────────
function GraphView({
  nodes,
  selectedNode,
  onSelect,
}: {
  nodes: GraphNode[];
  selectedNode: GraphNode | null;
  onSelect: (n: GraphNode | null) => void;
}) {
  if (nodes.length === 0)
    return (
      <div className="text-center py-20 bg-zinc-900/20 rounded-3xl border border-dashed border-zinc-800">
        <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">Graph is empty — facts auto-populate it</p>
      </div>
    );

  return (
    <div className="flex gap-6 flex-1 min-h-0 overflow-hidden">
      {/* Node Grid */}
      <div className="flex-1 overflow-y-auto pr-2 pb-8 grid gap-3 content-start"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
        {nodes.map(node => (
          <NodeCard key={node.id} node={node} selected={selectedNode?.id === node.id} onSelect={onSelect} />
        ))}
      </div>

      {/* Detail Panel */}
      {selectedNode && (
        <div className="w-80 flex-shrink-0 bg-zinc-900/60 border border-zinc-800 rounded-3xl p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <span className="text-2xl">{NODE_TYPE_ICONS[selectedNode.type] ?? "📌"}</span>
            <button
              onClick={() => onSelect(null)}
              className="text-zinc-600 hover:text-zinc-300 text-xs font-bold uppercase tracking-widest transition-colors"
            >
              Close ✕
            </button>
          </div>
          <h3 className="text-lg font-black text-white mb-1">{selectedNode.label}</h3>
          <span className={cn("px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border bg-gradient-to-br",
            NODE_TYPE_COLORS[selectedNode.type] ?? NODE_TYPE_COLORS.topic)}>
            {selectedNode.type}
          </span>

          {selectedNode.description && (
            <p className="text-zinc-400 text-sm mt-3 leading-relaxed">{selectedNode.description}</p>
          )}

          {/* Importance bar */}
          <div className="mt-4">
            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-1.5">Importance</p>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 rounded-full transition-all"
                style={{ width: `${selectedNode.importance * 100}%` }}
              />
            </div>
          </div>

          {/* Tags */}
          {selectedNode.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {selectedNode.tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 bg-zinc-800 text-zinc-400 text-[10px] font-bold rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Edges */}
          {selectedNode.edges.length > 0 && (
            <div className="mt-5">
              <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-2">Connections</p>
              <div className="space-y-2">
                {selectedNode.edges.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={cn("text-[10px] font-black uppercase", RELATION_COLORS[e.relation] ?? "text-zinc-500")}>
                      {e.relation}
                    </span>
                    <span className="text-zinc-500">→</span>
                    <span className="text-zinc-300 font-medium">{e.target.label}</span>
                    <span className="ml-auto text-[10px] text-zinc-600">{e.weight.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-zinc-700 mt-5 font-bold uppercase tracking-widest">
            Accessed {selectedNode.access_count}×
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Node Card ──────────────────────────────────────────────────────────────────
function NodeCard({ node, selected, onSelect }: { node: GraphNode; selected: boolean; onSelect: (n: GraphNode) => void }) {
  const colorClass = NODE_TYPE_COLORS[node.type] ?? NODE_TYPE_COLORS.topic;
  const icon = NODE_TYPE_ICONS[node.type] ?? "📌";

  return (
    <button
      onClick={() => onSelect(node)}
      className={cn(
        "text-left p-4 rounded-2xl border bg-gradient-to-br transition-all duration-200 hover:scale-[1.02] hover:shadow-lg",
        colorClass,
        selected ? "ring-2 ring-cyan-500/50 scale-[1.02]" : ""
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-xl">{icon}</span>
        <span className="text-[9px] font-black uppercase tracking-widest opacity-60">{node.type}</span>
      </div>
      <p className="font-bold text-white text-sm leading-tight">{node.label}</p>
      {node.description && (
        <p className="text-[11px] mt-1 opacity-60 line-clamp-2">{node.description}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {/* Edge count badge */}
        {node.edges.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-bold opacity-70">
            <GitBranch size={9} />
            {node.edges.length}
          </span>
        )}
        {/* Importance dots */}
        <div className="flex gap-0.5 ml-auto">
          {[...Array(5)].map((_, i) => (
            <div key={i} className={cn("w-1 h-1 rounded-full", i < Math.round(node.importance * 5) ? "bg-current opacity-70" : "bg-current opacity-10")} />
          ))}
        </div>
      </div>
    </button>
  );
}

// ─── Stat Badge ─────────────────────────────────────────────────────────────────
function StatBadge({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    cyan: "bg-cyan-500/10 border-cyan-500/20 text-cyan-400",
    violet: "bg-violet-500/10 border-violet-500/20 text-violet-400",
    amber: "bg-amber-500/10 border-amber-500/20 text-amber-400",
    zinc: "bg-zinc-800 border-zinc-700 text-zinc-400",
  };
  return (
    <div className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[11px] font-bold", colorMap[color])}>
      {icon}
      <span className="opacity-70 uppercase tracking-widest">{label}</span>
      <span className="font-black">{value}</span>
    </div>
  );
}
