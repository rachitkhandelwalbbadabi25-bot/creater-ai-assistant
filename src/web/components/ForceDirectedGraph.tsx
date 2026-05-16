"use client";

import React, { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface Node {
  id: string;
  label: string;
  type: string;
  x?: number;
  y?: number;
}

interface Edge {
  source: string;
  target: string;
  relation: string;
}

interface Props {
  nodes: Node[];
  edges: Edge[];
  onNodeClick: (nodeLabel: string) => void;
  selectedNodeLabel: string | null;
}

export default function ForceDirectedGraph({ nodes, edges, onNodeClick, selectedNodeLabel }: Props) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const width = 800;
  const height = 600;

  // Initialize random positions
  useEffect(() => {
    const initial: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n, i) => {
      initial[n.id] = {
        x: width / 2 + (Math.random() - 0.5) * 400,
        y: height / 2 + (Math.random() - 0.5) * 300,
      };
    });
    setPositions(initial);
  }, [nodes]);

  // Simple force simulation (one-time or limited steps for simplicity in this environment)
  useEffect(() => {
    if (Object.keys(positions).length === 0) return;

    let current = { ...positions };
    const steps = 50;
    
    for (let s = 0; s < steps; s++) {
      const next: Record<string, { x: number; y: number }> = {};
      
      nodes.forEach(n1 => {
        let fx = 0;
        let fy = 0;
        const p1 = current[n1.id];
        if (!p1) return;

        // Repulsion between all nodes
        nodes.forEach(n2 => {
          if (n1.id === n2.id) return;
          const p2 = current[n2.id];
          if (!p2) return;
          
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const distSq = dx * dx + dy * dy + 0.1;
          const force = 1000 / distSq;
          fx += (dx / Math.sqrt(distSq)) * force;
          fy += (dy / Math.sqrt(distSq)) * force;
        });

        // Attraction for edges
        edges.forEach(edge => {
          if (edge.source === n1.id || edge.target === n1.id) {
            const otherId = edge.source === n1.id ? edge.target : edge.source;
            const p2 = current[otherId];
            if (!p2) return;
            
            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const force = (dist - 150) * 0.05;
            fx -= (dx / (dist + 0.1)) * force;
            fy -= (dy / (dist + 0.1)) * force;
          }
        });

        // Gravity to center
        fx -= (p1.x - width / 2) * 0.01;
        fy -= (p1.y - height / 2) * 0.01;

        next[n1.id] = {
          x: Math.max(50, Math.min(width - 50, p1.x + fx)),
          y: Math.max(50, Math.min(height - 50, p1.y + fy)),
        };
      });
      current = next;
    }
    setPositions(current);
  }, [nodes, edges]);

  return (
    <div className="relative w-full h-[600px] bg-zinc-900/50 rounded-3xl border border-zinc-800/50 overflow-hidden cursor-grab active:cursor-grabbing">
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        {/* Edges */}
        {edges.map((edge, i) => {
          const p1 = positions[edge.source];
          const p2 = positions[edge.target];
          if (!p1 || !p2) return null;
          
          return (
            <g key={`edge-${i}`}>
              <line
                x1={p1.x} y1={p1.y}
                x2={p2.x} y2={p2.y}
                stroke="#3f3f46"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                className="opacity-40"
              />
              <text
                x={(p1.x + p2.x) / 2}
                y={(p1.y + p2.y) / 2}
                fill="#71717a"
                fontSize="10"
                textAnchor="middle"
                className="pointer-events-none select-none font-bold uppercase tracking-tighter"
              >
                {edge.relation}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map(node => {
          const p = positions[node.id];
          if (!p) return null;
          const isSelected = selectedNodeLabel === node.label;

          return (
            <g
              key={node.id}
              transform={`translate(${p.x}, ${p.y})`}
              onClick={() => onNodeClick(node.label)}
              className="cursor-pointer group"
            >
              <circle
                r={isSelected ? 34 : 28}
                className={cn(
                  "transition-all duration-300",
                  isSelected 
                    ? "fill-cyan-500/20 stroke-cyan-500 stroke-2" 
                    : "fill-zinc-800 stroke-zinc-700 hover:stroke-zinc-500"
                )}
              />
              <text
                dy="4"
                textAnchor="middle"
                className={cn(
                  "text-[10px] font-bold select-none transition-colors",
                  isSelected ? "fill-cyan-400" : "fill-zinc-400 group-hover:fill-zinc-200"
                )}
              >
                {node.label.length > 8 ? node.label.slice(0, 8) + ".." : node.label}
              </text>
              <title>{node.label} ({node.type})</title>
            </g>
          );
        })}
      </svg>
      
      <div className="absolute bottom-6 right-6 flex flex-col gap-2">
        <div className="bg-zinc-800/80 backdrop-blur-sm border border-zinc-700/50 rounded-xl px-4 py-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
           {nodes.length} Nodes • {edges.length} Connections
        </div>
      </div>
    </div>
  );
}
