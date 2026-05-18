"use client";

import React, { useEffect, useState } from "react";
import { 
  Activity, 
  Cpu, 
  Database, 
  Heart, 
  LayoutDashboard, 
  MessageSquare, 
  Settings, 
  Zap,
  Battery
} from "lucide-react";
import { getStatusAction } from "@/app/actions";
import { cn } from "@/lib/utils";

export default function Sidebar({ activeTab, setActiveTab }: { activeTab: string, setActiveTab: (t: string) => void }) {
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      const res = await getStatusAction();
      if (res.success) setMetrics(res.data);
    };
    fetchData();
    const timer = setInterval(fetchData, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <aside className="w-72 bg-zinc-950 border-r border-zinc-800 flex flex-col h-screen sticky top-0 overflow-y-auto">
      {/* Brand */}
      <div className="p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.5)]">
            <Zap className="text-white fill-white" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">CREATER</h1>
            <p className="text-xs text-zinc-500 font-medium tracking-widest uppercase">AI Assistant</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 space-y-2">
        <NavItem 
          icon={<MessageSquare size={20} />} 
          label="Chat" 
          active={activeTab === "Chat"} 
          onClick={() => setActiveTab("Chat")}
        />
        <NavItem 
          icon={<Database size={20} />} 
          label="Memory" 
          active={activeTab === "Memory"} 
          onClick={() => setActiveTab("Memory")}
        />
        <NavItem 
          icon={<Activity size={20} />} 
          label="Analytics" 
          active={activeTab === "Analytics"} 
          onClick={() => setActiveTab("Analytics")}
        />
        <NavItem 
          icon={<Settings size={20} />} 
          label="Settings" 
          active={activeTab === "Settings"} 
          onClick={() => setActiveTab("Settings")}
        />
      </nav>

      {/* System Stats */}
      <div className="p-6 space-y-6 bg-zinc-900/50">
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest px-1">System Health</h3>
        
        <div className="space-y-4">
          <StatBar 
            icon={<Cpu size={14} />} 
            label="CPU Usage" 
            value={metrics?.system?.cpu?.usage ?? 0} 
            color="bg-cyan-500" 
          />
          <StatBar 
            icon={<Activity size={14} />} 
            label="RAM" 
            value={metrics?.system?.ram?.usagePercent ?? 0} 
            color="bg-purple-500" 
          />
          <StatBar 
            icon={<Battery size={14} />} 
            label="Battery" 
            value={metrics?.system?.battery?.percent ?? 0} 
            color="bg-emerald-500" 
          />
        </div>

        <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart className="text-rose-500 fill-rose-500" size={16} />
            <span className="text-sm font-medium text-zinc-300">{metrics?.stats?.lastMood || "Neutral"}</span>
          </div>
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        </div>
      </div>
    </aside>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group text-left",
        active 
          ? "bg-zinc-800 text-cyan-400 shadow-lg" 
          : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
      )}
    >
      <span className={cn(active ? "text-cyan-400" : "text-zinc-500 group-hover:text-zinc-400")}>
        {icon}
      </span>
      <span className="font-semibold">{label}</span>
    </button>
  );
}

function StatBar({ icon, label, value, color }: { icon: React.ReactNode, label: string, value: number, color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[11px] font-bold text-zinc-400">
        <div className="flex items-center gap-1.5">
          {icon}
          <span>{label}</span>
        </div>
        <span>{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
        <div 
          className={cn("h-full transition-all duration-500 ease-out", color)} 
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
