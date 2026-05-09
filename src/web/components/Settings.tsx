"use client";

import React, { useState } from "react";
import { 
  Settings as SettingsIcon, 
  Shield, 
  MessageSquare, 
  Bell, 
  Cpu, 
  Lock,
  Eye,
  Save,
  Check
} from "lucide-react";
import { updateSettingsAction } from "@/app/actions";
import { cn } from "@/lib/utils";

export default function Settings() {
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    await updateSettingsAction({ proactive: true });
    setIsSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <SettingsIcon className="text-zinc-400" size={28} />
            Assistant Settings
          </h2>
          <p className="text-zinc-500 text-sm mt-1 font-medium uppercase tracking-widest">Configure AI Personality & System Safety</p>
        </div>
        <button 
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-cyan-500/20"
        >
          {saved ? <Check size={18} /> : isSaving ? <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" /> : <Save size={18} />}
          {saved ? "Saved" : isSaving ? "Saving..." : "Save Changes"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl">
        {/* Proactive Features */}
        <SettingsGroup icon={<Bell size={18} />} title="Proactive Intelligence">
          <ToggleItem label="Morning Briefing" description="Receive a daily digest of tasks, weather, and stats." defaultChecked />
          <ToggleItem label="Health Alerts" description="Battery, late-night, and usage warnings." defaultChecked />
          <ToggleItem label="Memory Synthesis" description="Periodically clean and summarize past conversations." />
        </SettingsGroup>

        {/* Safety & Tools */}
        <SettingsGroup icon={<Shield size={18} />} title="Safety & Permissions">
          <SelectItem 
            label="Safety Mode" 
            options={["Strict", "Moderate", "Permissive"]} 
            description="Control how much verification tools require." 
          />
          <ToggleItem label="Shell Confirmation" description="Ask before running sensitive bash commands." defaultChecked />
          <ToggleItem label="Auto-Skill Generation" description="Allow AI to suggest new skills from patterns." defaultChecked />
        </SettingsGroup>

        {/* Interface */}
        <SettingsGroup icon={<Eye size={18} />} title="Interface & Output">
          <SelectItem 
            label="Primary Model" 
            options={["qwen2.5-coder:7b", "llama3.1", "mistral"]} 
            description="LLM engine used for reasoning." 
          />
          <ToggleItem label="Hinglish Support" description="Enable natural Hindi+English mixed responses." defaultChecked />
          <ToggleItem label="Telegram Integration" description="Relay alerts and chat to Telegram bot." defaultChecked />
          <ToggleItem label="Voice Recognition" description="Enable 'Hey Creater' background wake-word detection." />
        </SettingsGroup>

        {/* Privacy */}
        <SettingsGroup icon={<Lock size={18} />} title="Privacy & Storage">
          <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-zinc-200">Local-First Storage</p>
              <p className="text-xs text-zinc-500 mt-0.5">All data stays on this device.</p>
            </div>
            <span className="px-2 py-1 bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase tracking-widest border border-emerald-500/20 rounded">Active</span>
          </div>
          <button className="w-full py-3 bg-zinc-900 border border-zinc-800 hover:border-rose-500/50 hover:text-rose-500 rounded-2xl text-zinc-500 text-xs font-bold uppercase tracking-widest transition-all">
            Clear Local Cache
          </button>
        </SettingsGroup>
      </div>
    </div>
  );
}

function SettingsGroup({ icon, title, children }: { icon: any, title: string, children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <div className="text-zinc-500">{icon}</div>
        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{title}</h3>
      </div>
      <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-3xl p-6 space-y-6">
        {children}
      </div>
    </div>
  );
}

function ToggleItem({ label, description, defaultChecked = false }: { label: string, description: string, defaultChecked?: boolean }) {
  return (
    <div className="flex items-center justify-between group">
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-zinc-200 group-hover:text-white transition-colors">{label}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input type="checkbox" defaultChecked={defaultChecked} className="sr-only peer" />
        <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500 peer-checked:after:bg-white"></div>
      </label>
    </div>
  );
}

function SelectItem({ label, options, description }: { label: string, options: string[], description: string }) {
  return (
    <div className="space-y-2.5">
      <div className="flex justify-between">
        <p className="text-sm font-semibold text-zinc-200">{label}</p>
        <p className="text-xs text-zinc-500 italic">Recommended</p>
      </div>
      <select className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-300 outline-none focus:border-cyan-500/50 transition-all appearance-none cursor-pointer font-medium">
        {options.map(opt => <option key={opt}>{opt}</option>)}
      </select>
      <p className="text-[11px] text-zinc-600 font-medium">{description}</p>
    </div>
  );
}
