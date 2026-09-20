'use client';

import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, Languages, CheckCircle2, AlertCircle, ShieldCheck, CloudOff, Cloud } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { toast } from 'sonner';
import {
  saveGeminiApiKey,
  deleteGeminiApiKey,
  isGeminiConfigured,
  migrateLegacyGeminiKey,
  isCloudTranslationEnabled,
  setCloudTranslationEnabled,
} from '@/services/geminiTranslationService';

export function GeminiSettings() {
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [isConfigured, setIsConfigured] = useState<boolean>(false);
  const [isCloudEnabled, setIsCloudEnabled] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    async function loadStatus() {
      // Step 1: Attempt migration of legacy localStorage key if present
      try {
        const migration = await migrateLegacyGeminiKey();
        if (migration.migrated) {
          toast.success('已自动将旧版存储的 Gemini API 密钥安全迁移至系统凭据库');
        } else if (migration.error) {
          toast.error(
            `Gemini 密钥迁移至系统凭据库失败，已保留原存储，请重新输入保存: ${migration.error}`
          );
        }
      } catch (migrationErr) {
        console.error('Migration error:', migrationErr);
      }

      // Step 2: Query whether key is configured in OS secure vault
      // Note: The key itself is NEVER read back to the frontend; only status is retrieved
      const configured = await isGeminiConfigured();
      setIsConfigured(configured);
      setApiKey('');
      setIsCloudEnabled(isCloudTranslationEnabled());
    }

    loadStatus();
  }, []);

  const handleSave = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      toast.info('请输入有效的 Gemini API 密钥');
      return;
    }

    setIsSaving(true);
    try {
      await saveGeminiApiKey(trimmed);
      // Key is cleared from memory immediately after saving
      setApiKey('');
      setIsConfigured(true);
      toast.success('Gemini API 密钥已安全保存至系统凭据库');
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || String(err);
      console.error('Failed to save API key to secure vault:', err);
      toast.error(`保存 API 密钥失败: ${errMsg}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsSaving(true);
    try {
      await deleteGeminiApiKey();
      setApiKey('');
      setIsConfigured(false);
      setIsCloudEnabled(false);
      toast.info('Gemini API 密钥已从系统凭据库中清除');
    } catch (err: unknown) {
      const errMsg = (err as { message?: string })?.message || String(err);
      console.error('Failed to delete API key from secure vault:', err);
      toast.error(`清除 API 密钥失败: ${errMsg}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleCloudTranslation = (enabled: boolean) => {
    if (enabled && !isConfigured && !apiKey.trim()) {
      toast.error('请先配置并保存 Gemini API 密钥后再启用云端翻译');
      return;
    }

    setCloudTranslationEnabled(enabled);
    setIsCloudEnabled(enabled);

    if (enabled) {
      toast.success('已开启云端实时翻译 (Google Gemini API)');
    } else {
      toast.info('已停用云端实时翻译，后续请求已终止');
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-gray-200 dark:border-zinc-800 p-6 shadow-sm transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Languages className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
            实时中英翻译 (Google Gemini)
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {isConfigured ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
              <CheckCircle2 className="w-3.5 h-3.5" />
              密钥已配置 (系统凭据库)
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
              云翻译已授权
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-zinc-700">
              <CloudOff className="w-3.5 h-3.5" />
              云翻译未开启
            </span>
          )}
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-zinc-400 mb-5 leading-relaxed">
        为进行中的语音转录提供实时英文到简体中文的同步翻译。密钥由操作系统安全凭据库原生保管（Windows 凭据管理器 / macOS 钥匙串 / Linux Secret Service），绝不保存到数据库或普通配置文件。
      </p>

      {/* Cloud Authorization Toggle Section */}
      <div className="mb-6 p-4 rounded-lg bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-sm font-medium text-gray-900 dark:text-zinc-100 flex items-center gap-2">
              <Cloud className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              启用云端实时翻译授权
            </div>
            <p className="text-xs text-gray-500 dark:text-zinc-400">
              默认关闭。开启后，英文转录文本段落将发送至 Gemini 模型获取中文翻译。
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={isCloudEnabled}
              disabled={!isConfigured && !apiKey.trim()}
              onChange={(e) => handleToggleCloudTranslation(e.target.checked)}
            />
            <div className="w-11 h-6 bg-gray-200 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 dark:peer-checked:bg-blue-500 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"></div>
          </label>
        </div>

        {/* Privacy & Data Transmission Notice */}
        <div className="mt-3 rounded-md bg-blue-50/70 dark:bg-blue-950/30 p-3 border border-blue-100 dark:border-blue-900/50 text-xs text-blue-900 dark:text-blue-300">
          <div className="font-semibold flex items-center gap-1.5 mb-1 text-blue-800 dark:text-blue-300">
            <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            数据安全与隐私保护说明
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-blue-800/90 dark:text-blue-300/90 leading-relaxed">
            <li>本地转录文本将通过加密 HTTPS 发送至 Google Gemini API；</li>
            <li>原始录音文件始终保存在您的本地设备，绝对不会上传至云端；</li>
            <li>API 密钥仅由操作系统系统级凭据库存储，前端保存后不留存明文；</li>
            <li>关闭开关或清除密钥后，所有未完成的翻译队列将立即清空并取消。</li>
          </ul>
        </div>
      </div>

      <div className="space-y-4 max-w-xl">
        <div>
          <Label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1.5">
            Gemini API 密钥 (API Key)
          </Label>
          <div className="relative">
            <Input
              type={showApiKey ? 'text' : 'password'}
              className="pr-12 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                isConfigured
                  ? '已在系统凭据库中配置 (如需更换请输入新密钥)'
                  : 'AIzaSy...'
              }
            />
            <div className="absolute inset-y-0 right-0 pr-1 flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setShowApiKey(!showApiKey)}
                className="text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                title={showApiKey ? '隐藏密钥' : '显示密钥'}
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button
            type="button"
            disabled={isSaving || !apiKey.trim()}
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            {isSaving ? '正在保存...' : '保存密钥至凭据库'}
          </Button>
          {isConfigured && (
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={handleClear}
              className="text-sm text-gray-700 dark:text-zinc-300 hover:text-red-600 dark:hover:text-red-400 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              清除密钥
            </Button>
          )}
        </div>

        <p className="text-xs text-gray-500 dark:text-zinc-500 leading-relaxed pt-1">
          密钥用于受限调用 Google Gemini 翻译接口，不会输出至日志或普通配置文件。您可在{' '}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            Google AI Studio
          </a>{' '}
          免费创建及获取 API 密钥。
        </p>
      </div>
    </div>
  );
}
