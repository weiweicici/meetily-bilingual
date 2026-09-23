'use client';

import React, { useEffect, useState } from 'react';
import {
  translationStatsTracker,
  SessionTranslationStats,
  TranslationHealthStatus,
} from '@/services/translationStatsTracker';
import { isCloudTranslationEnabled } from '@/services/geminiTranslationService';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Copy, FolderOpen, Activity, Zap, Shield, AlertTriangle } from 'lucide-react';

export function TranslationHealthIndicator() {
  const [stats, setStats] = useState<SessionTranslationStats>(() =>
    translationStatsTracker.getStats()
  );
  const [isCloudEnabled, setIsCloudEnabled] = useState<boolean>(true);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  useEffect(() => {
    setIsCloudEnabled(isCloudTranslationEnabled());
    const unsubscribe = translationStatsTracker.subscribe(newStats => {
      setStats(newStats);
      setIsCloudEnabled(isCloudTranslationEnabled());
    });
    return () => unsubscribe();
  }, []);

  const handleCopyStats = async () => {
    try {
      const summary = translationStatsTracker.formatMarkdownSummary();
      await navigator.clipboard.writeText(summary);
      toast.success('已复制会话翻译统计报告');
    } catch {
      toast.error('复制统计报告失败');
    }
  };

  const handleOpenLogFolder = async () => {
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('api_open_translation_log_folder');
      } else {
        toast.info('在桌面端运行即可一键打开日志目录');
      }
    } catch (e) {
      toast.error(`打开日志目录失败: ${e}`);
    }
  };

  if (!isCloudEnabled) {
    return (
      <span
        title="实时双语翻译已停用 (可在设置中启用)"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-gray-400 bg-gray-100/80 dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-700/80 select-none cursor-default"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
        双语字幕未启用
      </span>
    );
  }

  // Render badge based on health status
  const renderBadgeContent = (health: TranslationHealthStatus) => {
    switch (health) {
      case 'groq_success':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 shadow-sm transition-colors">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Groq ●
          </span>
        );
      case 'groq_inflight':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 shadow-sm transition-colors">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            Groq …
          </span>
        );
      case 'groq_429':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800 shadow-sm transition-colors">
            <span className="w-2 h-2 rounded-full bg-orange-500"></span>
            Groq 429 ↻
          </span>
        );
      case 'gemini_fallback':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 shadow-sm transition-colors">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            Gemini ●
          </span>
        );
      case 'all_failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 shadow-sm transition-colors">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            Translation ✕
          </span>
        );
      case 'idle':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-gray-50 text-gray-700 border border-gray-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700 shadow-sm transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
            双语字幕就绪
          </span>
        );
    }
  };

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="点击查看翻译运行状态与会话统计"
          className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 rounded-md"
        >
          {renderBadgeContent(stats.currentHealth)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="bottom"
        className="w-80 p-4 text-xs bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-lg rounded-lg space-y-3 z-50"
      >
        <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-zinc-800">
          <div className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-zinc-100">
            <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            会话实时翻译状态
          </div>
          <span className="text-[10px] text-gray-500 dark:text-zinc-400">
            成功率 {stats.successRatePct}%
          </span>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2 text-gray-600 dark:text-zinc-400">
          <div className="p-2 rounded bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-800">
            <div className="text-[10px] text-gray-500 dark:text-zinc-400 flex items-center gap-1">
              <Zap className="w-3 h-3 text-orange-500" />
              Groq (主通道)
            </div>
            <div className="font-semibold text-gray-900 dark:text-zinc-100 mt-0.5">
              {stats.groqSuccesses} / {stats.groqRequests}
            </div>
            {stats.groq429Count > 0 && (
              <div className="text-[9px] text-amber-600 dark:text-amber-400 mt-0.5">
                429 限流: {stats.groq429Count}
              </div>
            )}
          </div>

          <div className="p-2 rounded bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-800">
            <div className="text-[10px] text-gray-500 dark:text-zinc-400 flex items-center gap-1">
              <Shield className="w-3 h-3 text-blue-500" />
              Gemini (备用)
            </div>
            <div className="font-semibold text-gray-900 dark:text-zinc-100 mt-0.5">
              {stats.geminiSuccesses} / {stats.geminiFallbackAttempts}
            </div>
            {stats.geminiFailures > 0 && (
              <div className="text-[9px] text-rose-500 mt-0.5">
                失败: {stats.geminiFailures}
              </div>
            )}
          </div>

          <div className="p-2 rounded bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-800">
            <div className="text-[10px] text-gray-500 dark:text-zinc-400">
              60s RPM (当前/峰值)
            </div>
            <div className="font-semibold text-gray-900 dark:text-zinc-100 mt-0.5">
              {stats.current60sRpm} / {stats.peak60sRpm} RPM
            </div>
          </div>

          <div className="p-2 rounded bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-800">
            <div className="text-[10px] text-gray-500 dark:text-zinc-400">
              批处理/节省请求
            </div>
            <div className="font-semibold text-gray-900 dark:text-zinc-100 mt-0.5">
              {stats.batchedSegments} 段 / 省 {stats.savedApiRequests} 次
            </div>
          </div>

          <div className="p-2 rounded bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-800">
            <div className="text-[10px] text-gray-500 dark:text-zinc-400">
              平均延迟 / 最大
            </div>
            <div className="font-semibold text-gray-900 dark:text-zinc-100 mt-0.5">
              {stats.avgLatencyMs} ms / {stats.maxLatencyMs} ms
            </div>
          </div>

          <div className="p-2 rounded bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-800">
            <div className="text-[10px] text-gray-500 dark:text-zinc-400">
              当前排队 / 峰值
            </div>
            <div className="font-semibold text-gray-900 dark:text-zinc-100 mt-0.5">
              {stats.currentQueueDepth} / {stats.maxQueueDepth}
            </div>
          </div>
        </div>

        {stats.allProviderFailures > 0 && (
          <div className="p-2 rounded bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 text-[11px] text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>有 {stats.allProviderFailures} 个段落双通道均未成功</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1 border-t border-gray-100 dark:border-zinc-800">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyStats}
            className="flex-1 text-[11px] h-7 gap-1"
          >
            <Copy className="w-3 h-3" />
            复制统计
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenLogFolder}
            className="flex-1 text-[11px] h-7 gap-1"
          >
            <FolderOpen className="w-3 h-3" />
            日志目录
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
