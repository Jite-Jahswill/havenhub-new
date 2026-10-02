'use client';

import { useTheme } from 'next-themes';

export function useIsDark(): boolean {
  return useTheme().resolvedTheme === 'dark';
}
