'use client';

import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { PermissionWarning } from '@/components/PermissionWarning';
import { TranslationHealthIndicator } from '@/components/TranslationHealthIndicator';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, GlobeIcon, ArrowDown } from 'lucide-react';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { usePermissionCheck } from '@/hooks/usePermissionCheck';
import { ModalType } from '@/hooks/useModalState';
import { useIsLinux } from '@/hooks/usePlatform';
import { useMemo, useState, useEffect, useRef, useCallback, ReactNode } from 'react';

/**
 * TranscriptPanel Component
 *
 * Displays transcript content with controls for copying, language settings,
 * top toolbar recording controls, and Smart Follow scrolling behavior.
 */

interface TranscriptPanelProps {
  // indicates stop-processing state for transcripts; derived from backend statuses.
  isProcessingStop: boolean;
  isStopping: boolean;
  showModal: (name: ModalType, message?: string) => void;
  recordingControls?: ReactNode;
}

const SCROLL_THRESHOLD = 80; // px threshold from bottom to consider at live bottom

export function TranscriptPanel({
  isProcessingStop,
  isStopping,
  showModal,
  recordingControls
}: TranscriptPanelProps) {
  // Contexts
  const { transcripts, transcriptContainerRef, copyTranscript, translationMap } = useTranscripts();
  const { transcriptModelConfig } = useConfig();
  const { isRecording, isPaused } = useRecordingState();
  const { checkPermissions, isChecking, hasSystemAudio, hasMicrophone } = usePermissionCheck();
  const isLinux = useIsLinux();

  // Smart Follow State
  const [followLive, setFollowLive] = useState(true);
  const [newSegmentsCount, setNewSegmentsCount] = useState(0);

  const followLiveRef = useRef(true);
  followLiveRef.current = followLive;

  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pausedAtCountRef = useRef(0);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevTranscriptsLengthRef = useRef(transcripts.length);

  // Smooth scroll to bottom helper
  const scrollToBottomSmooth = useCallback(() => {
    const container = transcriptContainerRef.current;
    if (!container) return;

    isProgrammaticScrollRef.current = true;
    if (programmaticScrollTimerRef.current) {
      clearTimeout(programmaticScrollTimerRef.current);
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });

    // Reset programmatic scroll flag after animation completes
    programmaticScrollTimerRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 400);
  }, [transcriptContainerRef]);

  // Return to live state & scroll to bottom
  const returnToLive = useCallback(() => {
    setFollowLive(true);
    followLiveRef.current = true;
    setNewSegmentsCount(0);
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    scrollToBottomSmooth();
  }, [scrollToBottomSmooth]);

  // 10-second user-idle timer management
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    // Only run idle timer when followLive is OFF
    if (followLiveRef.current) return;

    idleTimerRef.current = setTimeout(() => {
      // Check for active text selection before restoring Follow Live
      if (typeof window !== 'undefined') {
        const selection = window.getSelection();
        const hasActiveSelection = !!(
          selection &&
          !selection.isCollapsed &&
          selection.toString().trim().length > 0
        );

        if (hasActiveSelection) {
          // User has an active text selection - postpone auto-return
          resetIdleTimer();
          return;
        }
      }

      // No active selection and 10s idle elapsed -> smoothly restore Follow Live
      returnToLive();
    }, 10000);
  }, [returnToLive]);

  // Track user activity to reset 10-second idle timer when Follow Live is OFF
  useEffect(() => {
    if (followLive) {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }

    // Start 10s idle timer when entering paused follow state
    resetIdleTimer();

    const handleUserActivity = () => {
      resetIdleTimer();
    };

    const container = transcriptContainerRef.current;
    if (container) {
      container.addEventListener('mousemove', handleUserActivity, { passive: true });
      container.addEventListener('mousedown', handleUserActivity, { passive: true });
      container.addEventListener('touchstart', handleUserActivity, { passive: true });
      container.addEventListener('pointerdown', handleUserActivity, { passive: true });
      container.addEventListener('wheel', handleUserActivity, { passive: true });
    }
    document.addEventListener('selectionchange', handleUserActivity, { passive: true });

    return () => {
      if (container) {
        container.removeEventListener('mousemove', handleUserActivity);
        container.removeEventListener('mousedown', handleUserActivity);
        container.removeEventListener('touchstart', handleUserActivity);
        container.removeEventListener('pointerdown', handleUserActivity);
        container.removeEventListener('wheel', handleUserActivity);
      }
      document.removeEventListener('selectionchange', handleUserActivity);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [followLive, resetIdleTimer, transcriptContainerRef]);

  // Detect user scroll events on the transcript container
  useEffect(() => {
    const container = transcriptContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isProgrammaticScrollRef.current) {
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const isNearBottom = distanceFromBottom <= SCROLL_THRESHOLD;

      if (isNearBottom) {
        // User manually scrolled back to bottom -> restore Follow Live
        if (!followLiveRef.current) {
          setFollowLive(true);
          followLiveRef.current = true;
          setNewSegmentsCount(0);
          if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
          }
        }
      } else {
        // User intentionally scrolled upward -> pause Follow Live
        if (followLiveRef.current) {
          setFollowLive(false);
          followLiveRef.current = false;
          pausedAtCountRef.current = transcripts.length;
          setNewSegmentsCount(0);
        }
        // User interaction occurred -> reset 10s idle timer
        resetIdleTimer();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [transcriptContainerRef, resetIdleTimer, transcripts.length]);

  // Handle incoming transcripts
  useEffect(() => {
    const currentLength = transcripts.length;
    const prevLength = prevTranscriptsLengthRef.current;
    prevTranscriptsLengthRef.current = currentLength;

    if (currentLength === 0) return;

    if (followLiveRef.current) {
      // Auto-follow latest transcript when followLive is ON
      scrollToBottomSmooth();
    } else {
      // Follow Live is OFF: do NOT scroll, track new segments counter
      if (currentLength > prevLength) {
        const addedSincePause = Math.max(0, currentLength - pausedAtCountRef.current);
        setNewSegmentsCount(addedSincePause);
      }
    }
  }, [transcripts, scrollToBottomSmooth]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, []);

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(() =>
    transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
      sequence_id: t.sequence_id,
    })),
    [transcripts]
  );

  return (
    <div className="relative w-full h-full flex flex-col flex-1 overflow-hidden">
      {/* Scrollable Transcript Panel Container */}
      <div
        ref={transcriptContainerRef}
        className="w-full h-full border-r border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex flex-col overflow-y-auto"
      >
        {/* Title area - Sticky header with Left status/tools and Right recording controls */}
        <div className="sticky top-0 z-10 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-sm px-4 py-2.5 border-b border-gray-200 dark:border-zinc-800">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 min-h-[44px]">
            {/* Left: TranslationHealthIndicator (Groq) & ButtonGroup (Copy, Language) */}
            <div className="flex items-center space-x-3">
              <TranslationHealthIndicator />
              <ButtonGroup>
                {transcripts?.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyTranscript}
                    title="Copy Transcript"
                  >
                    <Copy />
                    <span className='hidden md:inline'>
                      Copy
                    </span>
                  </Button>
                )}
                {transcriptModelConfig.provider === "localWhisper" &&
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => showModal('languageSettings')}
                    title="Language"
                  >
                    <GlobeIcon />
                    <span className='hidden md:inline'>
                      Language
                    </span>
                  </Button>
                }
              </ButtonGroup>
            </div>

            {/* Right: Existing Recording Controls (reused with all state & handlers) */}
            {recordingControls && (
              <div className="flex items-center justify-end">
                {recordingControls}
              </div>
            )}
          </div>
        </div>

        {/* Permission Warning - Not needed on Linux */}
        {!isRecording && !isChecking && !isLinux && (
          <div className="flex justify-center px-4 pt-4">
            <PermissionWarning
              hasMicrophone={hasMicrophone}
              hasSystemAudio={hasSystemAudio}
              onRecheck={checkPermissions}
              isRechecking={isChecking}
            />
          </div>
        )}

        {/* Transcript content */}
        <div className="pb-20">
          <div className="flex justify-center">
            <div className="w-2/3 max-w-[750px]">
              <VirtualizedTranscriptView
                segments={segments}
                translationMap={translationMap}
                isRecording={isRecording}
                isPaused={isPaused}
                isProcessing={isProcessingStop}
                isStopping={isStopping}
                enableStreaming={isRecording}
                showConfidence={true}
                disableAutoScroll={true}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Smart Follow Indicator - Unobtrusive button at bottom-right of viewport */}
      {!followLive && transcripts.length > 0 && (
        <div className="absolute bottom-6 right-8 z-20 pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-200">
          <button
            onClick={returnToLive}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900/90 dark:bg-zinc-800/90 hover:bg-zinc-800 dark:hover:bg-zinc-700 text-white dark:text-zinc-100 rounded-full shadow-lg border border-zinc-700/50 backdrop-blur-sm text-xs font-medium transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer"
            title="Return to latest transcript"
          >
            <ArrowDown className="w-3.5 h-3.5 text-blue-400" />
            <span>Live</span>
            {newSegmentsCount > 0 && (
              <>
                <span className="text-zinc-400 dark:text-zinc-500">·</span>
                <span className="text-blue-400 font-semibold">{newSegmentsCount} new</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
