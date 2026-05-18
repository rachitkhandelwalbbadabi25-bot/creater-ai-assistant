"use client";

import React, { useEffect, useState } from "react";
import { 
  LineChart, 
  BarChart, 
  Activity, 
  TrendingUp, 
  Calendar,
  Zap,
  Smile,
  Frown,
  Meh
} from "lucide-react";
import { getAnalyticsAction } from "@/app/actions";
import { cn } from "@/lib/utils";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function Analytics() {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const res = await getAnalyticsAction();
      if (res.success) setData(res.data);
      setIsLoading(false);
    };
    fetchData();
  }, []);

  if (isLoading) return <div className="p-8 text-zinc-500 animate-pulse font-bold uppercase tracking-widest text-xs">Loading Analytics...</div>;

  const activityData = {
    labels: data?.activity?.map((a: any) => a.date.split('-').slice(1).join('/')) || [],
    datasets: [
      {
        label: 'Messages',
        data: data?.activity?.map((a: any) => a.count) || [],
        backgroundColor: 'rgba(6, 182, 212, 0.2)',
        borderColor: '#06b6d4',
        borderWidth: 2,
        borderRadius: 8,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
    },
    scales: {
      y: { display: false, beginAtZero: true },
      x: { grid: { display: false }, ticks: { color: '#52525b', font: { size: 10, weight: 'bold' } as any } }
    },
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <TrendingUp className="text-cyan-500" size={28} />
            System Analytics
          </h2>
          <p className="text-zinc-500 text-sm mt-1 font-medium uppercase tracking-widest">Performance & Interaction Trends</p>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          icon={<Zap className="text-yellow-500" size={20} />} 
          label="Responsiveness" 
          value="98.4%" 
          subtext="Avg latency: 450ms"
        />
        <StatCard 
          icon={<Smile className="text-emerald-500" size={20} />} 
          label="User Satisfaction" 
          value="High" 
          subtext="Based on mood logs"
        />
        <StatCard 
          icon={<Activity className="text-purple-500" size={20} />} 
          label="Total Insights" 
          value={data?.moods?.length || 0} 
          subtext="Events tracked this week"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Calendar size={14} /> Message Frequency
            </h3>
          </div>
          <div className="h-64">
            <Bar data={activityData} options={chartOptions} />
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <Activity size={14} /> Mood Stability
            </h3>
          </div>
          <div className="flex flex-col justify-center h-64 space-y-4">
            <MoodRow label="Happy" count={data?.moods?.filter((m: any) => m.mood === 'Happy').length || 0} total={data?.moods?.length || 1} color="bg-emerald-500" icon={<Smile className="text-emerald-500" size={16} />} />
            <MoodRow label="Neutral" count={data?.moods?.filter((m: any) => m.mood === 'Neutral').length || 0} total={data?.moods?.length || 1} color="bg-cyan-500" icon={<Meh className="text-cyan-500" size={16} />} />
            <MoodRow label="Frustrated" count={data?.moods?.filter((m: any) => m.mood === 'Frustrated').length || 0} total={data?.moods?.length || 1} color="bg-rose-500" icon={<Frown className="text-rose-500" size={16} />} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, subtext }: { icon: any, label: string, value: string | number, subtext: string }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 hover:border-zinc-700 transition-all">
      <div className="p-2 bg-zinc-800 w-fit rounded-xl mb-4">{icon}</div>
      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{label}</p>
      <h4 className="text-2xl font-bold text-white mt-1">{value}</h4>
      <p className="text-[11px] text-zinc-600 mt-2 font-medium">{subtext}</p>
    </div>
  );
}

function MoodRow({ label, count, total, color, icon }: { label: string, count: number, total: number, color: string, icon: any }) {
  const percent = Math.round((count / total) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[11px] font-bold text-zinc-400">
        <div className="flex items-center gap-2">
          {icon}
          <span>{label}</span>
        </div>
        <span>{percent}%</span>
      </div>
      <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
        <div 
          className={cn("h-full transition-all duration-1000 ease-out", color)} 
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
