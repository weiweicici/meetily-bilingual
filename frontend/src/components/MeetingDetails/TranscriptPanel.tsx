"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { TranscriptView } from '@/components/TranscriptView';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  getGeminiApiKey,
  translateWithGemini,
  getMeetingTranslations,
  saveMeetingTranslations,
} from '@/services/geminiTranslationService';
import { storageService } from '@/services/storageService';
import { hasLegacyTranslations, migrateMeetingLegacyTranslations } from '@/services/legacyTranslationMigration';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptPanelProps) {
  const [translationMap, setTranslationMap] = useState<Record<string | number, string>>({});
  const translationMapRef = useRef<Record<string | number, string>>(translationMap);
  const activeMeetingIdRef = useRef<string | undefined>(meetingId);
  const isTranslatingQueueRef = useRef<boolean>(false);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [untranslatedCount, setUntranslatedCount] = useState<number>(0);

  // Load saved meeting translations from SQLite / localStorage and update activeMeetingIdRef
  useEffect(() => {
    activeMeetingIdRef.current = meetingId;
    if (meetingId) {
      // 1. Check & migrate legacy translations from localStorage if present
      if (hasLegacyTranslations(meetingId)) {
        migrateMeetingLegacyTranslations(meetingId).catch(err => {
          console.warn('[TranscriptPanel] Failed to migrate legacy translations:', err);
        });
      }

      // 2. Populate translationMap from localStorage and any already-loaded transcript translations
      const saved = getMeetingTranslations(meetingId);
      const initialMap: Record<string | number, string> = { ...saved };

      // Also index any translations directly embedded in transcripts
      transcripts.forEach(t => {
        if (t.translation) {
          if (t.id) initialMap[t.id] = t.translation;
          if (t.text) initialMap[t.text.trim()] = t.translation;
          if (t.sequence_id !== undefined) initialMap[t.sequence_id] = t.translation;
        }
      });

      if (segments) {
        segments.forEach(seg => {
          if (seg.translation) {
            if (seg.id) initialMap[seg.id] = seg.translation;
            if (seg.text) initialMap[seg.text.trim()] = seg.translation;
            if (seg.sequence_id !== undefined) initialMap[seg.sequence_id] = seg.translation;
          }
        });
      }

      setTranslationMap(initialMap);
      translationMapRef.current = initialMap;
    } else {
      setTranslationMap({});
      translationMapRef.current = {};
    }
  }, [meetingId, transcripts, segments]);

  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
      sequence_id: t.sequence_id,
      translation: t.translation,
    }));
  }, [transcripts, usePagination, segments]);

  // Sequential translation processor to avoid rate limits
  const processMissingTranslations = useCallback(async () => {
    if (!meetingId || isRecording || isTranslatingQueueRef.current) return;
    const apiKey = getGeminiApiKey();
    if (!apiKey) return;

    const targetMeetingId = meetingId;

    const missing = convertedSegments.filter(seg => {
      const text = seg.text?.trim();
      if (!text) return false;
      const current = translationMapRef.current;
      const exists =
        seg.translation ||
        (seg.sequence_id !== undefined && current[seg.sequence_id]) ||
        current[text] ||
        (seg.id && current[seg.id]);
      return !exists;
    });

    if (missing.length === 0) {
      setUntranslatedCount(0);
      return;
    }

    isTranslatingQueueRef.current = true;
    setIsTranslating(true);
    setUntranslatedCount(missing.length);

    try {
      for (const seg of missing) {
        // Abort if user navigated to a different meeting
        if (activeMeetingIdRef.current !== targetMeetingId) {
          console.log(`[MeetingDetails] Meeting changed, aborting translation for ${targetMeetingId}`);
          break;
        }

        const text = seg.text?.trim();
        if (!text) continue;

        if (translationMapRef.current[text]) continue;

        try {
          console.log('[MeetingDetails] Sequentially translating missing segment...');
          const trans = await translateWithGemini(text, apiKey);

          // Check again after async fetch
          if (activeMeetingIdRef.current !== targetMeetingId) break;

          if (trans) {
            setTranslationMap(prev => {
              const updated = {
                ...prev,
                [text]: trans,
                ...(seg.sequence_id !== undefined ? { [seg.sequence_id]: trans } : {}),
                ...(seg.id ? { [seg.id]: trans } : {}),
              };
              translationMapRef.current = updated;
              saveMeetingTranslations(targetMeetingId, updated);
              return updated;
            });

            // Persist translation to SQLite database if transcript id is available
            if (seg.id) {
              storageService.saveTranscriptTranslation(seg.id, trans).catch(err => {
                console.warn('[MeetingDetails] Failed to save translation to SQLite:', err);
              });
            }

            setUntranslatedCount(prev => Math.max(0, prev - 1));
          }
        } catch (err) {
          console.warn('[MeetingDetails] Sequential translate error:', err);
        }

        // Polite delay between requests to avoid Gemini 429 rate limit errors
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    } finally {
      isTranslatingQueueRef.current = false;
      if (activeMeetingIdRef.current === targetMeetingId) {
        setIsTranslating(false);
        const remaining = convertedSegments.filter(seg => {
          const text = seg.text?.trim();
          if (!text) return false;
          return !translationMapRef.current[text];
        }).length;
        setUntranslatedCount(remaining);
      }
    }
  }, [meetingId, isRecording, convertedSegments]);

  // Automatically process missing translations after segments are loaded
  useEffect(() => {
    if (!meetingId || isRecording || convertedSegments.length === 0) return;
    const timer = setTimeout(() => {
      processMissingTranslations();
    }, 600);
    return () => clearTimeout(timer);
  }, [meetingId, isRecording, convertedSegments, processMissingTranslations]);

  return (
    <div className="flex h-full min-w-0 w-full bg-white flex-col relative @container">
      {/* Title area */}
      <div className="p-4 border-b border-gray-200">
        <TranscriptButtonGroup
          transcriptCount={usePagination ? (totalCount ?? convertedSegments.length) : (transcripts?.length || 0)}
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={onRefetchTranscripts}
          isTranslating={isTranslating}
          untranslatedCount={untranslatedCount}
          onTranslateMissing={processMissingTranslations}
        />
      </div>

      {/* Transcript content - use virtualized view for better performance */}
      <div className="flex-1 overflow-hidden pb-4">
        <VirtualizedTranscriptView
          segments={convertedSegments}
          translationMap={translationMap}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
        />
      </div>

      {/* Custom prompt input at bottom of transcript section */}
      {!isRecording && convertedSegments.length > 0 && (
        <div className="p-1 border-t border-gray-200">
          <textarea
            placeholder="Add context for AI summary. For example people involved, meeting overview, objective etc..."
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm min-h-[80px] resize-y"
            value={customPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
