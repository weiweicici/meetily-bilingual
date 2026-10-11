'use client';

import React, { useEffect, useState } from 'react';
import {
  translationStatsTracker,
  SessionTranslationStats,
  TranslationHealthStatus,
} from '@/services/translationStatsTracker';
import {
  isCloudTranslationEnabled,
  setCloudTranslationEnabled,
  getUserTranslationMode,
} from '@/services/geminiTranslationService';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Copy, FolderOpen, Activity, Zap, Shield, AlertTriangle, Server, Power } from 'lucide-react';

export function TranslationHealthIndicator() {
  const [stats, setStats] = useState<SessionTranslationStats>(() =>
    translationStatsTracker.getStats()
  );
  const [isCloudEnabled, setIsCloudEnabled] = useState<boolean>(true);
  const [providerMode, setProviderMode] = useState<string>('cloud');
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  useEffect(() => {
    setIsCloudEnabled(isCloudTranslationEnabled());
    setProviderMode(getUserTranslationMode());
    const unsubscribe = translationStatsTracker.subscribe(newStats => {
      setStats(newStats);
      setIsCloudEnabled(isCloudTranslationEnabled());
      setProviderMode(getUserTranslationMode());
    });
    return () => unsubscribe();
  }, []);

  const handleToggleTranslation = (enabled: boolean) => {
    setCloudTranslationEnabled(enabled);
    setIsCloudEnabled(enabled);
    if (enabled) {
      toast.success('已开启实时双语翻译');
    } else {
      toast.info('已暂停实时翻译');
    }
  };

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

  // Render badge based on health status
  const renderBadgeContent = (health: TranslationHealthStatus) => {
    if (!isCloudEnabled) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-gray-500 dark:text-zinc-400 bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 shadow-sm transition-colors hover:bg-gray-200 dark:hover:bg-zinc-700">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-zinc-500"></span>
          双语字幕 (已暂停)
        </span>
      );
    }

    switch (health) {
      case 'local_qwen_success':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 shadow-sm transition-colors">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Local Qwen3 ●
          </span>
        );
      case 'local_qwen_inflight':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 shadow-sm transition-colors">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            Local Qwen3 …
          </span>
        );
      case 'local_qwen_error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 shadow-sm transition-colors">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            Local Qwen3 ✕
          </span>
        );
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
            {providerMode === 'local_qwen' ? 'Local Qwen3 就绪' : '双语字幕就绪'}
          </span>
        );
    }
  };

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="点击查看翻译运行状态与控制开关"
          className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20 rounded-md"
        >
          {renderBadgeContent(stats.currentHealth)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
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

        {/* Quick ON/OFF Toggle */}
        <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Power className={`w-4 h-4 ${isCloudEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`} />
            <div>
              <div className="font-semibold text-gray-800 dark:text-zinc-200 text-xs">
                实时翻译开关
              </div>
              <div className="text-[10px] text-gray-500 dark:text-zinc-400">
                {isCloudEnabled ? '新到达段落将自动翻译' : '已暂停自动翻译'}
              </div>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={isCloudEnabled}
              onChange={(e) => handleToggleTranslation(e.target.checked)}
            />
            <div className="w-9 h-5 bg-gray-200 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600 dark:peer-checked:bg-blue-500"></div>
          </label>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2 text-gray-600 dark:text-zinc-400">
          {providerMode === 'local_qwen' ? (
            <div className="p-2 rounded bg-gray-50 dark:bg-zinc-800/60 border border-gray-100 dark:border-zinc-800 col-span-2">
              <div className="text-[10px] text-gray-500 dark:text-zinc-400 flex items-center gap-1">
                <Server className="w-3 h-3 text-indigo-500" />
                Local Qwen3 (Mac mini)
              </div>
              <div className="font-semibold text-gray-900 dark:text-zinc-100 mt-0.5">
                {stats.localQwenSuccesses} / {stats.localQwenRequests} 成功
              </div>
              {stats.localQwenFailures > 0 && (
                <div className="text-[9px] text-rose-500 mt-0.5">
                  失败: {stats.localQwenFailures}
                </div>
              )}
            </div>
          ) : (
            <>
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
            </>
          )}

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
            <span>有 {stats.allProviderFailures} 个段落翻译未成功</span>
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

