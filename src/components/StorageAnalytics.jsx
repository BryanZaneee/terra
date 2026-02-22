import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  X, BarChart3, HardDrive, Image as ImageIcon, Film,
  MonitorSmartphone, Copy, AlertTriangle
} from 'lucide-react';
import {
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { formatBytes } from '../utils/photoHelpers';

const CHART_COLORS = {
  photos: '#10b981',
  videos: '#3b82f6',
  screenshots: '#f97316',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a1a] border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-xs text-white/60 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-xs" style={{ color: entry.color }}>
          {entry.name}: {formatBytes(entry.value)}
        </p>
      ))}
    </div>
  );
};

const StorageAnalytics = ({ isOpen, onClose, onNavigateToPhoto, onOpenDuplicateReview }) => {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [scanningFileSizes, setScanningFileSizes] = useState(false);
  const [scanProgress, setScanProgress] = useState({ total: 0, processed: 0 });

  useEffect(() => {
    if (isOpen) loadAnalytics();
  }, [isOpen]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const data = await invoke('get_storage_analytics');
      setAnalytics(data);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleScanFileSizes = async () => {
    setScanningFileSizes(true);
    setScanProgress({ total: 0, processed: 0 });

    const unlisten = await listen('file_size_progress', (event) => {
      setScanProgress({ total: event.payload.total, processed: event.payload.processed });
      if (event.payload.phase === 'complete') {
        setScanningFileSizes(false);
        loadAnalytics();
      }
    });

    try {
      await invoke('populate_file_sizes');
    } catch (err) {
      console.error('Failed to scan file sizes:', err);
      setScanningFileSizes(false);
    } finally {
      unlisten();
    }
  };

  if (!isOpen) return null;

  const pieData = analytics ? [
    { name: 'Photos', value: analytics.photos_size, color: CHART_COLORS.photos },
    { name: 'Videos', value: analytics.videos_size, color: CHART_COLORS.videos },
    { name: 'Screenshots', value: analytics.screenshots_size, color: CHART_COLORS.screenshots },
  ].filter(d => d.value > 0) : [];

  const yearData = analytics?.size_by_year?.map(y => ({
    name: y.year,
    size: y.size,
    count: y.count,
  })).reverse() || [];

  const monthData = analytics?.size_by_month?.map(m => ({
    name: m.month,
    size: m.size,
    count: m.count,
  })).reverse() || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md animate-in fade-in duration-200 overflow-hidden">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <BarChart3 size={24} className="text-emerald-400" />
              Storage Analytics
            </h2>
            <p className="text-white/60 text-sm mt-1">
              {analytics ? `${formatBytes(analytics.total_size_bytes)} total` : 'Loading...'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="w-12 h-12 border-2 border-white/20 border-t-emerald-400 rounded-full animate-spin"></div>
              <p className="text-white/50 text-sm mt-4">Loading analytics...</p>
            </div>
          ) : !analytics ? (
            <div className="h-full flex flex-col items-center justify-center text-white/40">
              <AlertTriangle size={48} className="mb-4" />
              <p>Failed to load analytics</p>
            </div>
          ) : (
            <div className="space-y-8 max-w-6xl mx-auto">
              {/* Scan banner if needed */}
              {analytics.total_size_bytes === 0 && (analytics.total_photos > 0 || analytics.total_videos > 0) && (
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertTriangle size={20} className="text-yellow-400" />
                    <div>
                      <p className="text-sm text-white">File sizes need to be scanned</p>
                      <p className="text-xs text-white/50">Run a one-time scan to populate size data for analytics.</p>
                    </div>
                  </div>
                  <button
                    onClick={handleScanFileSizes}
                    disabled={scanningFileSizes}
                    className="px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-lg text-sm font-medium border border-yellow-500/30 transition-colors disabled:opacity-50"
                  >
                    {scanningFileSizes
                      ? `Scanning ${scanProgress.processed}/${scanProgress.total}...`
                      : 'Scan File Sizes'}
                  </button>
                </div>
              )}

              {/* Summary Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                  icon={HardDrive}
                  iconColor="text-emerald-400"
                  label="Total Size"
                  value={formatBytes(analytics.total_size_bytes)}
                />
                <SummaryCard
                  icon={ImageIcon}
                  iconColor="text-emerald-400"
                  label="Photos"
                  value={analytics.total_photos.toLocaleString()}
                  sub={formatBytes(analytics.photos_size)}
                />
                <SummaryCard
                  icon={Film}
                  iconColor="text-blue-400"
                  label="Videos"
                  value={analytics.total_videos.toLocaleString()}
                  sub={formatBytes(analytics.videos_size)}
                />
                <SummaryCard
                  icon={MonitorSmartphone}
                  iconColor="text-orange-400"
                  label="Screenshots"
                  value={analytics.total_screenshots.toLocaleString()}
                  sub={formatBytes(analytics.screenshots_size)}
                />
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Pie Chart */}
                {pieData.length > 0 && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                    <h3 className="text-sm font-medium text-white/70 mb-4">Media Type Distribution</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {pieData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                        <Legend
                          formatter={(value) => <span className="text-white/60 text-xs">{value}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Bar Chart - By Year */}
                {yearData.length > 0 && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                    <h3 className="text-sm font-medium text-white/70 mb-4">Storage by Year</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={yearData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                        <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} tickFormatter={formatBytes} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="size" fill="#10b981" radius={[4, 4, 0, 0]} name="Size" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Area Chart - By Month */}
              {monthData.length > 0 && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                  <h3 className="text-sm font-medium text-white/70 mb-4">Storage by Month (Last 12 Months)</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={monthData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
                      <YAxis tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} tickFormatter={formatBytes} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="size"
                        stroke="#10b981"
                        fill="#10b981"
                        fillOpacity={0.15}
                        name="Size"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Top Largest Files */}
              {analytics.top_largest_files.length > 0 && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                  <h3 className="text-sm font-medium text-white/70 mb-4">Top 10 Largest Files</h3>
                  <div className="space-y-1">
                    {analytics.top_largest_files.map((file, i) => (
                      <button
                        key={file.path}
                        onClick={() => onNavigateToPhoto && onNavigateToPhoto(file.path)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-left group"
                      >
                        <span className="text-xs text-white/30 font-mono w-5">{i + 1}</span>
                        <span className="flex-1 text-sm text-white/80 truncate group-hover:text-white">{file.name}</span>
                        <span className="text-xs text-white/50 font-mono">{formatBytes(file.size)}</span>
                        <span className="text-xs text-white/30">
                          {new Date(file.date_taken * 1000).toLocaleDateString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Duplicate Savings */}
              {analytics.duplicate_space_bytes > 0 && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Copy size={20} className="text-yellow-400" />
                      <div>
                        <p className="text-sm text-white">Reclaimable Space from Duplicates</p>
                        <p className="text-lg font-bold text-yellow-400">{formatBytes(analytics.duplicate_space_bytes)}</p>
                      </div>
                    </div>
                    {onOpenDuplicateReview && (
                      <button
                        onClick={onOpenDuplicateReview}
                        className="px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 rounded-lg text-sm font-medium border border-yellow-500/30 transition-colors"
                      >
                        Review Duplicates
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SummaryCard = ({ icon: Icon, iconColor, label, value, sub }) => (
  <div className="bg-white/5 border border-white/10 rounded-xl p-4">
    <div className="flex items-center gap-2 mb-2">
      <Icon size={16} className={iconColor} />
      <span className="text-xs text-white/50 uppercase tracking-wider">{label}</span>
    </div>
    <p className="text-xl font-bold text-white">{value}</p>
    {sub && <p className="text-xs text-white/40 mt-0.5">{sub}</p>}
  </div>
);

export default StorageAnalytics;
