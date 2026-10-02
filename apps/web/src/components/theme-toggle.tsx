'use client';

import { ThemePreference } from '@havenhub/shared';
import { cn } from '@havenhub/ui';
import { useTheme } from 'next-themes';
import { useSyncExternalStore, type ReactNode } from 'react';

const OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  {
    value: ThemePreference.LIGHT,
    label: 'Light',
    icon: (
      <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
    ),
  },
  {
    value: ThemePreference.DARK,
    label: 'Dark',
    icon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />,
  },
  {
    value: ThemePreference.SYSTEM,
    label: 'System',
    icon: <path d="M4 5h16v11H4zM9 20h6m-3-4v4" />,
  },
];

const subscribe = () => () => {};

function ThemeIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/**
 * `segmented` shows all three choices; `compact` is a single button for tight
 * spaces (the mobile header) that cycles light → dark → system.
 */
export function ThemeToggle({ variant = 'segmented' }: { variant?: 'segmented' | 'compact' }) {
  const { theme, setTheme } = useTheme();
  // The stored preference is only known on the client; avoid a hydration mismatch.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  if (variant === 'compact') {
    const index = mounted ? OPTIONS.findIndex((option) => option.value === theme) : -1;
    const current = OPTIONS[index] ?? OPTIONS[2]!;
    const next = OPTIONS[(index + 1) % OPTIONS.length]!;
    const label = mounted
      ? `Colour theme: ${current.label}. Switch to ${next.label}`
      : 'Colour theme';
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setTheme(next.value)}
        className="grid size-9 place-items-center rounded-full border border-border bg-surface-secondary text-text hover:bg-surface"
      >
        <ThemeIcon>{current.icon}</ThemeIcon>
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-secondary p-0.5"
    >
      {OPTIONS.map((option) => {
        const selected = mounted && theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            onClick={() => setTheme(option.value)}
            className={cn(
              'grid size-8 place-items-center rounded-full transition-colors',
              selected ? 'bg-surface text-text shadow-card' : 'text-text-muted hover:text-text',
            )}
          >
            <ThemeIcon>{option.icon}</ThemeIcon>
          </button>
        );
      })}
    </div>
  );
}
