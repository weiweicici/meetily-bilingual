'use client';

import React from 'react';
import { useTheme, Theme } from '@/contexts/ThemeContext';
import { Sun, Moon, Laptop } from 'lucide-react';

export function ThemeSettings() {
  const { theme, setTheme } = useTheme();

  const themes: { id: Theme; label: string; icon: React.ReactNode; description: string }[] = [
    {
      id: 'light',
      label: 'Light Theme',
      icon: <Sun className="w-5 h-5 text-amber-500" />,
      description: 'Clean bright layout for day use',
    },
    {
      id: 'dark',
      label: 'Dark Theme',
      icon: <Moon className="w-5 h-5 text-indigo-400" />,
      description: 'Comfortable dark mode for long classroom sessions',
    },
    {
      id: 'system',
      label: 'System Theme',
      icon: <Laptop className="w-5 h-5 text-gray-400" />,
      description: 'Match system color scheme automatically',
    },
  ];

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-gray-200 dark:border-zinc-800 p-6 shadow-sm transition-colors">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-zinc-100 mb-2">
        Appearance & Theme
      </h3>
      <p className="text-sm text-gray-600 dark:text-zinc-400 mb-4">
        Customize the visual style for optimal bilingual subtitle contrast during meetings.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {themes.map((t) => {
          const isActive = theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={`flex flex-col items-start p-4 rounded-xl border text-left transition-all ${
                isActive
                  ? 'border-blue-600 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 ring-2 ring-blue-500/20'
                  : 'border-gray-200 dark:border-zinc-800 hover:border-gray-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-800/40'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5 font-medium text-gray-900 dark:text-zinc-100 text-sm">
                {t.icon}
                <span>{t.label}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-zinc-400 leading-normal">
                {t.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
