'use client';

import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Languages, CheckCircle2, AlertCircle, ShieldCheck, CloudOff, Cloud, Zap, FolderOpen, Copy, Activity } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { toast } from 'sonner';
import {
  saveGeminiApiKey,
  deleteGeminiApiKey,
  isGeminiConfigured,
  saveGroqApiKey,
  deleteGroqApiKey,
  isGroqConfigured,
  migrateLegacyGeminiKey,
  isCloudTranslationEnabled,
  setCloudTranslationEnabled,
  getUserTranslationMode,
  setUserTranslationMode,
  UserTranslationMode,
  getLocalQwenEndpoint,
  setLocalQwenEndpoint,
  checkLocalQwenHealth,
  DEFAULT_LOCAL_QWEN_ENDPOINT,
} from '@/services/geminiTranslationService';
import { translationStatsTracker, SessionTranslationStats } from '@/services/translationStatsTracker';
import { Server, RefreshCw } from 'lucide-react';

export function GeminiSettings() {
  // Translation Provider Mode State
  const [providerMode, setProviderMode] = useState<UserTranslationMode>('cloud');

  // Local Qwen3 (Mac mini) State
  const [localEndpoint, setLocalEndpoint] = useState<string>(DEFAULT_LOCAL_QWEN_ENDPOINT);
  const [isTestingLocal, setIsTestingLocal] = useState<boolean>(false);
  const [localHealth, setLocalHealth] = useState<{ available: boolean; model?: string; latencyMs?: number; error?: string } | null>(null);

  // Groq State (Primary)
  const [groqKey, setGroqKey] = useState<string>('');
  const [showGroqKey, setShowGroqKey] = useState<boolean>(false);
  const [isGroqConfig, setIsGroqConfig] = useState<boolean>(false);
  const [isSavingGroq, setIsSavingGroq] = useState<boolean>(false);

  // Gemini State (Fallback)
  const [geminiKey, setGeminiKey] = useState<string>('');
  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false);
  const [isGeminiConfig, setIsGeminiConfig] = useState<boolean>(false);
  const [isSavingGemini, setIsSavingGemini] = useState<boolean>(false);

  // Global Translation Authorization State
  const [isCloudEnabled, setIsCloudEnabled] = useState<boolean>(false);

  // Diagnostics State
  const [logPath, setLogPath] = useState<string>('');
  const [sessionStats, setSessionStats] = useState<SessionTranslationStats>(() =>
    translationStatsTracker.getStats()
  );

  useEffect(() => {
    const unsubStats = translationStatsTracker.subscribe(s => setSessionStats(s));

    async function loadStatus() {
      // Step 1: Attempt migration of legacy localStorage Gemini key if present
      try {
        const migration = await migrateLegacyGeminiKey();
        if (migration.migrated) {
          toast.success('已自动将旧版存储的 Gemini API 密钥安全迁移至系统凭据库');
        }
      } catch (migrationErr) {
        console.error('Migration error:', migrationErr);
      }

      // Step 2: Query whether keys are configured in OS secure vault
      try {
        const groqStatus = await isGroqConfigured();
        setIsGroqConfig(groqStatus);
      } catch (e) {
        console.error('Error querying Groq status:', e);
      }

      try {
        const geminiStatus = await isGeminiConfigured();
        setIsGeminiConfig(geminiStatus);
      } catch (e) {
        console.error('Error querying Gemini status:', e);
      }

      // Step 3: Query diagnostic log path from backend
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const path = await invoke<string>('api_get_translation_log_path');
          setLogPath(path);
        } catch (e) {
          console.warn('Failed to resolve log path:', e);
        }
      }

      setGroqKey('');
      setGeminiKey('');
      setIsCloudEnabled(isCloudTranslationEnabled());
      setProviderMode(getUserTranslationMode());
      setLocalEndpoint(getLocalQwenEndpoint());

      // Check Local Qwen3 Health
      try {
        const health = await checkLocalQwenHealth();
        setLocalHealth(health);
      } catch {
        // Non fatal
      }
    }

    loadStatus();
    return () => unsubStats();
  }, []);

  const handleProviderChange = async (mode: UserTranslationMode) => {
    const result = await setUserTranslationMode(mode);
    if (result.success) {
      setProviderMode(mode);
      if (mode === 'cloud') {
        toast.success('已切换至 Cloud 翻译模式 (Groq + Gemini)');
      } else {
        toast.success('已切换至 Local Qwen3 (Mac mini) 局域网私有翻译');
      }
    } else {
      toast.error(result.error || 'Local Qwen3 服务暂不可达，请检查 Mac mini 与 Tailscale 连接');
    }
  };

  const handleTestLocalConnection = async () => {
    setIsTestingLocal(true);
    try {
      const health = await checkLocalQwenHealth(localEndpoint);
      setLocalHealth(health);
      if (health.available) {
        toast.success(`Local Qwen3 连接正常！模型: ${health.model} (延迟: ${health.latencyMs}ms)`);
      } else {
        toast.error(`连接失败: ${health.error || '无法访问 Mac mini 翻译服务'}`);
      }
    } catch (e) {
      toast.error(`测试连接失败: ${e}`);
    } finally {
      setIsTestingLocal(false);
    }
  };

  const handleSaveLocalEndpoint = () => {
    const clean = localEndpoint.trim();
    if (!clean) {
      toast.info('请输入有效的服务地址');
      return;
    }
    setLocalQwenEndpoint(clean);
    toast.success('Local Qwen3 服务地址已保存');
    handleTestLocalConnection();
  };

  const handleResetLocalEndpoint = () => {
    setLocalEndpoint(DEFAULT_LOCAL_QWEN_ENDPOINT);
    setLocalQwenEndpoint(DEFAULT_LOCAL_QWEN_ENDPOINT);
    toast.info('已重置为默认 Mac mini 节点地址');
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

  const handleCopyStats = async () => {
    try {
      const summary = translationStatsTracker.formatMarkdownSummary();
      await navigator.clipboard.writeText(summary);
      toast.success('已复制会话翻译统计报告');
    } catch {
      toast.error('复制统计报告失败');
    }
  };

  // --- Groq Handlers ---
  const handleSaveGroq = async () => {
    const trimmed = groqKey.trim();
    if (!trimmed) {
      toast.info('请输入有效的 Groq API 密钥');
      return;
    }

    setIsSavingGroq(true);
    try {
      await saveGroqApiKey(trimmed);
      setGroqKey('');
      setIsGroqConfig(true);
      toast.success('Groq API 密钥已安全保存至系统凭据库 (主要翻译源)');
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || String(err);
      console.error('Failed to save Groq API key:', err);
      toast.error(`保存 Groq API 密钥失败: ${errMsg}`);
    } finally {
      setIsSavingGroq(false);
    }
  };

  const handleClearGroq = async () => {
    setIsSavingGroq(true);
    try {
      await deleteGroqApiKey();
      setGroqKey('');
      setIsGroqConfig(false);
      toast.info('Groq API 密钥已从系统凭据库中清除');
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || String(err);
      console.error('Failed to delete Groq API key:', err);
      toast.error(`清除 Groq API 密钥失败: ${errMsg}`);
    } finally {
      setIsSavingGroq(false);
    }
  };

  // --- Gemini Handlers ---
  const handleSaveGemini = async () => {
    const trimmed = geminiKey.trim();
    if (!trimmed) {
      toast.info('请输入有效的 Gemini API 密钥');
      return;
    }

    setIsSavingGemini(true);
    try {
      await saveGeminiApiKey(trimmed);
      setGeminiKey('');
      setIsGeminiConfig(true);
      toast.success('Gemini API 密钥已安全保存至系统凭据库 (备用翻译源)');
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || String(err);
      console.error('Failed to save Gemini API key:', err);
      toast.error(`保存 Gemini API 密钥失败: ${errMsg}`);
    } finally {
      setIsSavingGemini(false);
    }
  };

  const handleClearGemini = async () => {
    setIsSavingGemini(true);
    try {
      await deleteGeminiApiKey();
      setGeminiKey('');
      setIsGeminiConfig(false);
      toast.info('Gemini API 密钥已从系统凭据库中清除');
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || String(err);
      console.error('Failed to delete Gemini API key:', err);
      toast.error(`清除 Gemini API 密钥失败: ${errMsg}`);
    } finally {
      setIsSavingGemini(false);
    }
  };

  // --- Global Toggle ---
  const handleToggleCloudTranslation = (enabled: boolean) => {
    if (enabled) {
      if (providerMode === 'local_qwen') {
        setCloudTranslationEnabled(true);
        setIsCloudEnabled(true);
        toast.success('已开启实时中英翻译 (Local Qwen3 Mac mini 本地节点)');
        return;
      }

      const hasAnyConfigured = isGroqConfig || isGeminiConfig || groqKey.trim() || geminiKey.trim();
      if (!hasAnyConfigured) {
        toast.error('请先配置并保存 Groq 或 Gemini API 密钥，或切换至 Local Qwen3 本地节点');
        return;
      }
      setCloudTranslationEnabled(true);
      setIsCloudEnabled(true);
      toast.success('已开启实时中英翻译 (首选 Groq，备用 Gemini)');
    } else {
      setCloudTranslationEnabled(false);
      setIsCloudEnabled(false);
      toast.info('已停用实时翻译，后续请求已终止');
    }
  };

  const hasConfiguredKeys = isGroqConfig || isGeminiConfig;

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-gray-200 dark:border-zinc-800 p-6 shadow-sm transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Languages className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
            实时中英翻译 (Cloud + Local Qwen3)
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {providerMode === 'local_qwen' ? (
            localHealth?.available ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mac mini 已连接
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                <AlertCircle className="w-3.5 h-3.5" />
                Mac mini 离线
              </span>
            )
          ) : hasConfiguredKeys ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
              <CheckCircle2 className="w-3.5 h-3.5" />
              云端凭据已就绪
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
              <AlertCircle className="w-3.5 h-3.5" />
              未配置密钥
            </span>
          )}
          {isCloudEnabled ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
              <Cloud className="w-3.5 h-3.5" />
              实时翻译已启用
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-zinc-700">
              <CloudOff className="w-3.5 h-3.5" />
              翻译已暂停
            </span>
          )}
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-zinc-400 mb-5 leading-relaxed">
        为语音转录提供极速实时中英双语字幕。支持在 Cloud 通道 (Groq + Gemini) 与 Local Qwen3 (Mac mini 私有网络节点) 之间平滑热切换。
      </p>

      {/* Translation Provider Selector */}
      <div className="mb-6 p-4 rounded-lg bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium text-gray-900 dark:text-zinc-100 flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            Translation Provider (翻译源选择)
          </div>
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300">
            {providerMode === 'local_qwen' ? 'Local Qwen3 (Mac mini)' : 'Cloud (Groq + Gemini)'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label
            onClick={() => handleProviderChange('cloud')}
            className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-all ${
              providerMode === 'cloud'
                ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-500 text-blue-900 dark:text-blue-100'
                : 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 hover:border-gray-300 dark:hover:border-zinc-600'
            }`}
          >
            <input
              type="radio"
              name="translation_provider"
              checked={providerMode === 'cloud'}
              onChange={() => handleProviderChange('cloud')}
              className="mt-0.5 text-blue-600"
            />
            <div>
              <div className="font-semibold text-sm">Cloud (Groq + Gemini)</div>
              <div className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                首选 Groq (20b/120b)，限流或故障自动降级至 Gemini。需互联网。
              </div>
            </div>
          </label>

          <label
            onClick={() => handleProviderChange('local_qwen')}
            className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-all ${
              providerMode === 'local_qwen'
                ? 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-500 text-blue-900 dark:text-blue-100'
                : 'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 hover:border-gray-300 dark:hover:border-zinc-600'
            }`}
          >
            <input
              type="radio"
              name="translation_provider"
              checked={providerMode === 'local_qwen'}
              onChange={() => handleProviderChange('local_qwen')}
              className="mt-0.5 text-blue-600"
            />
            <div>
              <div className="font-semibold text-sm">Local Qwen3 (Mac mini)</div>
              <div className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                通过 Tailscale 局域网访问 Mac mini Ollama qwen3:1.7b。私密安全。
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Global Translation Authorization Toggle */}
      <div className="mb-6 p-4 rounded-lg bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-sm font-medium text-gray-900 dark:text-zinc-100 flex items-center gap-2">
              <Cloud className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              启用实时双语字幕翻译 (Real-Time Translation)
            </div>
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              开启后，录音确认段落将自动翻译并实时渲染在英文字幕下方。关闭后停止发起新请求。
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={isCloudEnabled}
              onChange={(e) => handleToggleCloudTranslation(e.target.checked)}
            />
            <div className="w-11 h-6 bg-gray-200 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 dark:peer-checked:bg-blue-500"></div>
          </label>
        </div>

        {/* Security and Privacy Notice */}
        <div className="mt-3 rounded-md bg-blue-50/70 dark:bg-blue-950/30 p-3 border border-blue-100 dark:border-blue-900/50 text-xs text-blue-900 dark:text-blue-300">
          <div className="font-semibold flex items-center gap-1.5 mb-1 text-blue-800 dark:text-blue-300">
            <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            隐私与凭据安全说明
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-blue-800/90 dark:text-blue-300/90 leading-relaxed">
            <li>原始录音文件始终保存在本地，绝不上传至任何云端；</li>
            <li>Local Qwen3 模式仅通过 Tailscale 专用私有网络与 Mac mini 通信；</li>
            <li>API 密钥由系统凭据库独立隔离保管，不留存明文，不记录日志。</li>
          </ul>
        </div>
      </div>

      <div className="space-y-6 max-w-xl">
        {/* --- Local Qwen3 (Mac mini) Configuration --- */}
        {providerMode === 'local_qwen' && (
          <div className="p-4 rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/30 dark:bg-indigo-950/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Server className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <Label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                  Local Qwen3 (Mac mini) 服务节点配置
                </Label>
              </div>
              {localHealth?.available ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 已连接 ({localHealth.model}, {localHealth.latencyMs}ms)
                </span>
              ) : (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> 未连接
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-gray-600 dark:text-zinc-400">
                Tailscale Private URL / 服务端点:
              </Label>
              <Input
                type="text"
                className="bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 font-mono text-xs"
                value={localEndpoint}
                onChange={(e) => setLocalEndpoint(e.target.value)}
                placeholder="http://jeffsmac-mini.taile61984.ts.net:8080"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={handleSaveLocalEndpoint}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-8 px-3"
              >
                保存地址
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isTestingLocal}
                onClick={handleTestLocalConnection}
                className="text-xs h-8 px-3 gap-1.5"
              >
                {isTestingLocal ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5 text-indigo-500" />}
                测试连接
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetLocalEndpoint}
                className="text-xs h-8 px-2 text-gray-500 hover:text-gray-700 dark:text-zinc-400 ml-auto"
              >
                重置默认
              </Button>
            </div>
          </div>
        )}

        {/* --- Groq API Key Section (Primary) --- */}
        <div className="p-4 rounded-lg border border-orange-200 dark:border-orange-900/50 bg-orange-50/30 dark:bg-orange-950/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              <Label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                1. Groq API 密钥 (首选 / 超低延迟)
              </Label>
            </div>
            {isGroqConfig ? (
              <span className="text-xs text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 已配置
              </span>
            ) : (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> 未配置
              </span>
            )}
          </div>

          <div className="relative">
            <Input
              type={showGroqKey ? 'text' : 'password'}
              className="pr-12 bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder={
                isGroqConfig
                  ? '已在凭据库中配置 (如需更换请输入新密钥)'
                  : 'gsk_...'
              }
            />
            <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowGroqKey(!showGroqKey)}
                className="text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                title={showGroqKey ? '隐藏密钥' : '显示密钥'}
              >
                {showGroqKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              disabled={isSavingGroq || !groqKey.trim()}
              onClick={handleSaveGroq}
              className="bg-orange-600 hover:bg-orange-700 text-white text-xs h-8 px-3"
            >
              {isSavingGroq ? '保存中...' : '保存 Groq 密钥'}
            </Button>
            {isGroqConfig && (
              <Button
                type="button"
                variant="outline"
                disabled={isSavingGroq}
                onClick={handleClearGroq}
                className="text-xs h-8 px-3 text-gray-600 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"
              >
                清除
              </Button>
            )}
            <span className="text-xs text-gray-500 dark:text-zinc-400 ml-auto">
              获取地址:{' '}
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                className="text-orange-600 dark:text-orange-400 hover:underline"
              >
                console.groq.com
              </a>
            </span>
          </div>
        </div>

        {/* --- Gemini API Key Section (Fallback) --- */}
        <div className="p-4 rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-950/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Cloud className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <Label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                2. Google Gemini API 密钥 (备用 / 自动降级)
              </Label>
            </div>
            {isGeminiConfig ? (
              <span className="text-xs text-green-600 dark:text-green-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 已配置
              </span>
            ) : (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> 未配置
              </span>
            )}
          </div>

          <div className="relative">
            <Input
              type={showGeminiKey ? 'text' : 'password'}
              className="pr-12 bg-white dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              placeholder={
                isGeminiConfig
                  ? '已在凭据库中配置 (如需更换请输入新密钥)'
                  : 'AIzaSy...'
              }
            />
            <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowGeminiKey(!showGeminiKey)}
                className="text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                title={showGeminiKey ? '隐藏密钥' : '显示密钥'}
              >
                {showGeminiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              disabled={isSavingGemini || !geminiKey.trim()}
              onClick={handleSaveGemini}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-3"
            >
              {isSavingGemini ? '保存中...' : '保存 Gemini 密钥'}
            </Button>
            {isGeminiConfig && (
              <Button
                type="button"
                variant="outline"
                disabled={isSavingGemini}
                onClick={handleClearGemini}
                className="text-xs h-8 px-3 text-gray-600 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400"
              >
                清除
              </Button>
            )}
            <span className="text-xs text-gray-500 dark:text-zinc-400 ml-auto">
              获取地址:{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                aistudio.google.com
              </a>
            </span>
          </div>
        </div>

        {/* --- Translation Diagnostics Section --- */}
        <div className="p-4 rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-800/40 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <Label className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                翻译诊断与持久化日志 (Translation Diagnostics)
              </Label>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              <CheckCircle2 className="w-3 h-3 text-indigo-500" />
              日志轮换保护 (Max 5×5MB)
            </span>
          </div>

          <p className="text-xs text-gray-600 dark:text-zinc-400 leading-relaxed">
            记录每个序列段落 (<code>sequence_id</code>) 的请求生命周期、耗时与故障归因。日志绝不包含 API 密钥、英文转录文本或中文译文。
          </p>

          <div className="rounded border border-gray-200 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 p-2.5 space-y-2">
            <div className="flex flex-col gap-1 text-[11px]">
              <span className="text-gray-500 dark:text-zinc-400 font-medium">当前诊断日志存储位置:</span>
              <code className="px-2 py-1 rounded bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 break-all select-all font-mono text-[10px]">
                {logPath || '正在解析日志目录...'}
              </code>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100 dark:border-zinc-800 text-[11px]">
              <div className="p-1.5 rounded bg-gray-50 dark:bg-zinc-800 text-center">
                <div className="text-gray-500 dark:text-zinc-400 text-[10px]">总处理段落</div>
                <div className="font-semibold text-gray-800 dark:text-zinc-200 mt-0.5">{sessionStats.totalEligible}</div>
              </div>
              <div className="p-1.5 rounded bg-gray-50 dark:bg-zinc-800 text-center">
                <div className="text-gray-500 dark:text-zinc-400 text-[10px]">Groq 成功 / 次数</div>
                <div className="font-semibold text-gray-800 dark:text-zinc-200 mt-0.5">{sessionStats.groqSuccesses} / {sessionStats.groqRequests}</div>
              </div>
              <div className="p-1.5 rounded bg-gray-50 dark:bg-zinc-800 text-center">
                <div className="text-gray-500 dark:text-zinc-400 text-[10px]">Gemini 备用成功</div>
                <div className="font-semibold text-gray-800 dark:text-zinc-200 mt-0.5">{sessionStats.geminiSuccesses} / {sessionStats.geminiFallbackAttempts}</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleOpenLogFolder}
              className="text-xs h-8 gap-1.5"
            >
              <FolderOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              打开日志目录 (Open Log Folder)
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyStats}
              className="text-xs h-8 gap-1.5"
            >
              <Copy className="w-3.5 h-3.5 text-gray-600 dark:text-zinc-400" />
              复制会话统计 (Copy Statistics)
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
